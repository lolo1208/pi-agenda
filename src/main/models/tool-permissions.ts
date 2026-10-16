import { randomUUID } from 'node:crypto'
import type { AgentEvent, PermissionMode, ToolApproval } from '../../shared/models'
import { ModelError } from './model-validation'
import { toolApprovalPreview } from './tool-approval-preview'

/** 审批只授予当前工具调用；停止任务后所有待审批立即失效。 */
export class ToolApprovalManager {
  private pending = new Map<string, { requestId: string; conversationId: string; details: ToolApproval; finish(allow: boolean): void }>()
  constructor(private readonly emit: (event: AgentEvent) => void) {}
  async ask(requestId: string, conversationId: string, details: Omit<ToolApproval, 'id'>, signal: AbortSignal, onWaiting: (waiting: boolean) => void, rejectOnDeny = true): Promise<boolean> {
    signal.throwIfAborted()
    const id = randomUUID()
    const allowed = await new Promise<boolean>((resolve, reject) => {
      const cleanup = (): void => {
        this.pending.delete(id)
        signal.removeEventListener('abort', abort)
        onWaiting(false)
        this.emit({ type: 'approval-end', requestId, conversationId, approvalId: id })
      }
      const abort = (): void => { cleanup(); reject(new ModelError('工具审批已取消')) }
      this.pending.set(id, { requestId, conversationId, details: structuredClone({ ...details, id }), finish: allow => { cleanup(); resolve(allow) } })
      signal.addEventListener('abort', abort, { once: true })
      onWaiting(true)
      this.emit({ type: 'approval', requestId, conversationId, approval: { ...details, id } })
    })
    signal.throwIfAborted()
    if (!allowed && rejectOnDeny) throw new ModelError('用户拒绝了本次工具操作；请调整方案，不要重复尝试相同操作')
    return allowed
  }
  respond(requestId: string, conversationId: string, id: string, allow: boolean): void {
    const pending = this.pending.get(id)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) throw new ModelError('审批请求已失效或不属于当前任务')
    pending.finish(allow)
  }
  async preview(requestId: string, conversationId: string, id: string) {
    const pending = this.pending.get(id)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) throw new ModelError('审批请求已失效或不属于当前任务')
    const preview = await toolApprovalPreview(pending.details)
    if (this.pending.get(id) !== pending) throw new ModelError('审批请求已失效')
    return preview
  }
}

/** 只接受完整匹配的单条命令；自动模式由文件工具实现，不启动 Shell。 */
export function safeLocationCommand(command: string): boolean {
  return /^(?:pwd|Get-Location)\s*$/i.test(command.trim())
}

export function safeFileCommand(command: string): { tool: 'read' | 'ls'; path: string } | undefined {
  // 不接受通配符、变量展开、重定向或 Shell 组合语法。
  if (/[\r\n;&|<>`$*?]/.test(command)) return undefined
  const match = /^(cat|ls|Get-Content|Get-ChildItem)(?:\s+-LiteralPath)?(?:\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+)))?\s*$/i.exec(command.trim())
  if (!match) return undefined
  const target = match[2] ?? match[3] ?? match[4]
  const tool = /^(cat|Get-Content)$/i.test(match[1]) ? 'read' : 'ls'
  if ((tool === 'read' && !target) || target?.startsWith('-')) return undefined
  return { tool, path: target ?? '.' }
}

/** 默认或受限模式中的敏感路径；完全访问模式不再逐项确认。 */
export function highRiskFileMutation(target: string): boolean {
  const normalized = target.replace(/\\/g, '/').toLowerCase()
  return /^(?:[a-z]:\/(?:windows|program files(?: \(x86\))?|programdata)(?:\/|$)|\/(?:etc|boot|system|library|bin|sbin)(?:\/|$)|\/usr\/(?:bin|sbin|lib)(?:\/|$))/.test(normalized)
    || /\/(?:\.(?:bashrc|bash_profile|zshrc|zshenv|profile|gitconfig)|\.ssh\/(?:config|authorized_keys|known_hosts))$/.test(normalized)
    || /\/(?:\.config\/autostart|start menu\/programs\/startup|library\/(?:launchagents|launchdaemons))(?:\/|$)/.test(normalized)
}

export function commandApprovalReason(mode: PermissionMode, command: string): string | undefined {
  if (mode === 'full') return undefined
  if (mode === 'default') return '“每次询问”模式下，终端命令需要逐次确认。未隔离的 Shell 命令获准后可能访问项目外文件或网络'
  if (safeLocationCommand(command) || safeFileCommand(command)) return undefined
  if (mode === 'auto') return '当前命令没有可用的项目系统沙箱。获准后将使用本机权限，可能访问项目外文件或网络'
  return undefined
}
