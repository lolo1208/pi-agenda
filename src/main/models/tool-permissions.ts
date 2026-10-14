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

/** 系统目录、登录配置与自动启动文件的修改始终需要确认。 */
export function highRiskFileMutation(target: string): boolean {
  const normalized = target.replace(/\\/g, '/').toLowerCase()
  return /^(?:[a-z]:\/(?:windows|program files(?: \(x86\))?|programdata)(?:\/|$)|\/(?:etc|boot|system|library|bin|sbin)(?:\/|$)|\/usr\/(?:bin|sbin|lib)(?:\/|$))/.test(normalized)
    || /\/(?:\.(?:bashrc|bash_profile|zshrc|zshenv|profile|gitconfig)|\.ssh\/(?:config|authorized_keys|known_hosts))$/.test(normalized)
    || /\/(?:\.config\/autostart|start menu\/programs\/startup|library\/(?:launchagents|launchdaemons))(?:\/|$)/.test(normalized)
}

export function commandApprovalReason(mode: PermissionMode, command: string): string | undefined {
  if (mode === 'default') return '默认权限下，终端命令需要逐次确认。未隔离的 Shell 命令获准后可能访问项目外文件或网络'
  if (safeLocationCommand(command) || safeFileCommand(command)) return undefined
  if (mode === 'auto') return '当前命令没有可用的项目系统沙箱。获准后将使用本机权限，可能访问项目外文件或网络'
  // 间接执行与组合语法无法保证没有隐藏的高风险动作，完全访问也保留确认。
  if (/[\r\n;&|<>`$]/.test(command) || /(?:^|\s)(?:rm|rmdir|del|erase|Remove-Item|Clear-Content|format|diskpart|reg|Set-ItemProperty|Invoke-Expression|iex|eval|sudo|chmod|chown|curl|wget|Invoke-WebRequest|Invoke-RestMethod|Start-Process|cmd|powershell|pwsh|bash|sh|node|python\w*|ruby|perl|npm|pnpm|yarn|npx|make)(?:\s|$)/i.test(command) || /git\s+(?:reset|clean|push|rebase|checkout|restore|update-ref|filter-branch|config)\b/i.test(command) || /\.(?:ps1|bat|cmd|sh|py|js|mjs|cjs)(?:\s|$)/i.test(command)) return '该命令可能涉及删除、历史覆盖、系统修改或间接脚本执行，完全访问下仍需确认'
  // 仅放行明确列出的普通查询；未知程序的实现不可据名称推断。
  return '无法可靠判断该命令是否包含高风险操作，请确认本次执行'
}
