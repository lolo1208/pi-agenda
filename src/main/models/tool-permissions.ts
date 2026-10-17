import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { DEFAULT_COMMAND_APPROVAL_REASON, type AgentEvent, type PermissionMode, type ToolApproval } from '../../shared/models'
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

// 只收录常见参数下也不会写入文件的查看类程序；tree 等可借参数写文件的程序不收录（如 tree -o），
// 且重定向、管道、组合脚本在下面的判定中一律排除。
const readOnlyPrograms = new Set([
  'ls', 'dir', 'pwd', 'get-location', 'gl', 'get-childitem', 'gci',
  'cat', 'type', 'get-content', 'gc', 'more', 'head', 'tail', 'wc',
  'stat', 'get-item', 'gi', 'test-path', 'resolve-path', 'get-itemproperty',
  'grep', 'rg', 'select-string', 'sls', 'where', 'get-command', 'gcm',
  'echo', 'write-output', 'write-host', 'get-help'
])
// 这些 Git 子命令只读取仓库状态；reflog 改写、外部 diff 与 --output 等写文件参数另行排除。
const readOnlyGitSubcommands = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'blame', 'describe', 'cat-file', 'ls-files', 'ls-tree', 'grep', 'shortlog', 'whatchanged', 'reflog', 'count-objects', 'for-each-ref', 'show-ref', 'name-rev', 'merge-base', 'version', 'help'])

/** 只把完整单条且确定不写入项目文件的命令判为只读。组合、重定向、管道、变量展开、未知程序或可能写文件的参数都返回 false，继续保存修改前快照。 */
export function readOnlyCommand(command: string): boolean {
  const text = command.trim()
  if (!text || text.length > 1024) return false
  // 组合、管道、重定向、后台执行、命令替换与变量展开都可能间接写文件。
  if (/[\r\n;&|<>`]|\$\(|\$\{|@\(/.test(text)) return false
  const tokens = text.split(/\s+/)
  const program = path.basename(tokens[0]).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
  const args = tokens.slice(1)
  if (program !== 'git') return readOnlyPrograms.has(program)
  let index = 0
  // 跳过不改变只读语义的 Git 全局选项，例如 git --no-pager status。
  while (index < args.length) {
    const value = args[index]
    // -c 可以重定义别名（如 alias.status=!脚本），不能据此判定只读。
    if (value === '-c' || value.startsWith('-c')) return false
    if (['--no-pager', '--paginate', '--no-optional-locks', '--literal-pathspecs', '--no-replace-objects'].includes(value)) { index++; continue }
    if (value === '-C') { index += 2; continue }
    if (value.startsWith('--git-dir=') || value.startsWith('--work-tree=') || value.startsWith('--namespace=') || value.startsWith('--exec-path=')) { index++; continue }
    break
  }
  const subcommand = args[index]?.toLowerCase()
  if (!subcommand || !readOnlyGitSubcommands.has(subcommand)) return false
  const rest = args.slice(index + 1).map(value => value.toLowerCase())
  if (subcommand === 'reflog' && rest.some(value => ['expire', 'delete', 'drop'].includes(value))) return false
  if (['diff', 'log', 'show', 'grep'].includes(subcommand) && rest.some(value => value === '--ext-diff' || value === '--textconv' || value === '--output' || value.startsWith('--output='))) return false
  return true
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
  if (mode === 'default') return DEFAULT_COMMAND_APPROVAL_REASON
  if (safeLocationCommand(command) || safeFileCommand(command)) return undefined
  if (mode === 'auto') return '当前命令没有可用的项目系统沙箱。获准后将使用本机权限，可能访问项目外文件或网络'
  return undefined
}
