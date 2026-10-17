import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { TerminalSandbox } from './terminal-sandbox'
import { literalCommand } from './windows-command-parser'

type Result = Awaited<ReturnType<ToolDefinition['execute']>>
export interface CommandRecovery {
  kind: 'runtime-access' | 'file-operation' | 'permission-denied' | 'execution-failed'
  state: 'recovered' | 'unresolved' | 'awaiting-approval' | 'denied'
  execution: 'not-started' | 'completed' | 'partial-or-unknown'
  attempts: number
  message: string
  originalError?: string
}

export function withCommandRecovery(result: Result, recovery: CommandRecovery): Result {
  return { ...result, content: [...result.content, { type: 'text', text: `命令恢复状态：${JSON.stringify(recovery)}` }], details: { ...(result.details && typeof result.details === 'object' ? result.details : {}), recovery } }
}

const quote = (value: string): string => "'" + value.replace(/'/g, "''") + "'"
// Git 已有启动探针与专用兼容后端恢复，避免在每次查询前重复启动隔离进程。
const knownRuntimes = new Set(['node', 'npm', 'npx', 'pnpm', 'corepack', 'yarn', 'python', 'python3', 'py', 'cargo', 'rustc', 'dotnet', 'go', 'java', 'javac'])
const permissionFailure = /EACCES|EPERM|Permission denied|UnauthorizedAccess|Access(?: is)? denied|Access to[^\r\n]{0,200}denied|WinError 5\b|os error 5\b|0x80070005|拒绝访问|访问被拒绝|权限不足/i
const outputOf = (result: Result): string => result.content.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join('\n')
const failed = (result: Result): boolean => {
  const structured = result.structuredContent
  return result.isError === true || !!(structured && typeof structured === 'object' && 'exit_code' in structured && typeof structured.exit_code === 'number' && structured.exit_code !== 0)
}
const failure = (message: string): Result => ({ content: [{ type: 'text', text: message }], details: {}, isError: true })

interface RecoveryOptions {
  root: string
  command: string
  sandbox: TerminalSandbox
  signal?: AbortSignal
  onRecovery?(message: string): void
  /** 路径校验只允许项目内普通文件，并排除凭据、应用数据及链接。 */
  localPath(value: string): Promise<string>
  execute(command: string, outside: boolean): Promise<Result>
  approve(command: string, runtime: string, reason: string): Promise<void>
}

/** 不启动宿主程序，仅检查 PATH 元数据，区分未安装和隔离进程不可见。 */
export async function findHostRuntime(name: string, root: string, environment: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const directories = /[\\/]/.test(name) ? [''] : (environment.PATH ?? '').split(path.delimiter).map(value => value.trim().replace(/^"|"$/g, '')).filter(Boolean)
  const extensions = path.extname(name) ? [''] : ['.exe', '.com', '.cmd', '.bat', '.ps1']
  for (const directory of directories) for (const extension of extensions) {
    const candidate = path.resolve(root, directory, name + extension)
    try { if ((await stat(candidate)).isFile()) return candidate } catch { /* 其他候选仍可检查。 */ }
  }
  return undefined
}

/** 每个任务一个协调器；未知执行结果和被拒绝的命令不会自动重放。 */
export class WindowsCommandRecovery {
  private readonly blocked = new Map<string, Result>()

  previous(command: string): Result | undefined {
    const tokens = literalCommand(command)
    return this.blocked.get(tokens ? JSON.stringify(tokens) : command.trim())
  }

  remember(command: string, result: Result): void {
    const tokens = literalCommand(command)
    this.blocked.set(tokens ? JSON.stringify(tokens) : command.trim(), result)
  }

  async run(options: RecoveryOptions): Promise<Result> {
    const { command, root, sandbox, signal, onRecovery } = options
    signal?.throwIfAborted()
    const tokens = literalCommand(command)
    const key = tokens ? JSON.stringify(tokens) : command.trim()
    const previous = this.blocked.get(key)
    if (previous) return previous
    // 开发后端已负责工具安装文件的只读访问；仍保留部分执行与禁止自动重放的结果管理。
    if (sandbox.developerTools) return this.execute(options, key, command, false)
    let actual = command, repaired = false
    const name = tokens?.[0]
    // 裸字符串不是 PowerShell 调用；仅诊断有限的原生程序，绝不拆开复合脚本。
    const callable = !/^['"]/.test(command.trim())
    if (tokens && name && callable && knownRuntimes.has(path.basename(name).replace(/\.(exe|cmd|bat|com|ps1)$/i, '').toLowerCase())) {
      if (/^(npm|pnpm|npx|corepack|yarn)(\.(exe|cmd|ps1))?$/i.test(path.basename(name))) onRecovery?.('正在使用隔离配置和缓存检查工具，随后继续执行')
      const visible = await this.visible(sandbox, name, root, signal)
      if (!visible) {
        const host = await findHostRuntime(name, root)
        let local: string | undefined
        if (!/[\\/]/.test(name)) {
          const base = name.replace(/\.(exe|cmd|bat|com|ps1)$/i, '')
          for (const directory of ['', '.bin', 'node_modules/.bin']) {
            for (const extension of path.extname(name) ? [''] : ['.exe', '.cmd', '.ps1']) {
              let candidate: string
              try {
                candidate = await options.localPath(path.join(root, directory, base + (path.extname(name) ? path.extname(name) : extension)))
                if (!(await stat(candidate)).isFile()) continue
              } catch { signal?.throwIfAborted(); continue }
              if (await this.visible(sandbox, candidate, root, signal)) { local = candidate; break }
            }
            if (local) break
          }
        }
        if (local) {
          actual = `& ${[local, ...tokens.slice(1)].map(quote).join(' ')}`
          repaired = true
          onRecovery?.('已自动改用项目内可访问的运行时，正在继续执行')
        } else {
          const originalError = `隔离进程无法定位命令：${name}`
          if (!host) return withCommandRecovery(failure(`${originalError}；宿主 PATH 中也未找到可用程序。请配置已安装工具的路径，或安装工具后继续。`), { kind: 'runtime-access', state: 'unresolved', execution: 'not-started', attempts: 0, originalError, message: '尚不能确认工具已安装，不申请扩权，也不自动下载安装。' })
          const result = withCommandRecovery(failure(`${originalError}；本机已找到 ${host}，但当前隔离后端无法访问该工具。原命令未执行，请排查开发工具隔离环境。`), { kind: 'runtime-access', state: 'unresolved', execution: 'not-started', attempts: 0, originalError, message: '工具调用无需审批，不申请或静默使用完整本机权限。' })
          this.blocked.set(key, result)
          return result
        }
      }
    }
    return this.execute(options, key, actual, false, repaired ? `隔离进程无法定位原运行时：${name}` : undefined)
  }

  private async visible(sandbox: TerminalSandbox, name: string, root: string, signal?: AbortSignal): Promise<boolean> {
    const marker = `pi-runner-runtime-${randomUUID()}`
    const command = `$runtime=Get-Command -Name ${quote(name)} -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1; if ($runtime) { Write-Output '${marker}:available' } else { Write-Output '${marker}:missing' }`
    let output = ''
    const result = await sandbox.exec(command, root, { signal, timeout: 15, onData: data => { output = (output + data.toString('utf8')).slice(-16000) } })
    signal?.throwIfAborted()
    if (result.exitCode === 0 && output.split(/\r?\n/).includes(`${marker}:available`)) return true
    if (result.exitCode === 0 && output.split(/\r?\n/).includes(`${marker}:missing`)) return false
    // 探针失败不能证明用户命令可以安全转到本机，更不能掩盖隔离失效。
    throw new Error(`运行时访问诊断未完成，原命令尚未执行：${output.trim() || '未收到有效诊断结果'}；请检查沙箱状态后继续。`)
  }

  private async execute(options: RecoveryOptions, key: string, command: string, outside: boolean, originalError?: string): Promise<Result> {
    let result: Result
    try { result = await options.execute(command, outside) }
    catch (error) {
      options.signal?.throwIfAborted()
      result = failure(error instanceof Error ? error.message : String(error))
    }
    if (failed(result)) {
      const output = outputOf(result)
      const uncertain = permissionFailure.test(output) || /timed? out|timeout|超时|aborted|取消/i.test(output)
      const annotated = withCommandRecovery(result, { kind: permissionFailure.test(output) ? 'permission-denied' : 'execution-failed', state: 'unresolved', execution: 'partial-or-unknown', attempts: originalError ? 1 : 0, originalError: originalError ?? output, message: uncertain ? '保留以上原始结果；命令可能已产生修改，不自动重跑或扩权。先核对文件及已有结果，再用文件工具完成剩余操作；确需项目外访问时单独请求本次批准。' : '程序执行失败；按原始错误修正参数或实现，不因非零退出码申请扩权。' })
      if (uncertain) this.blocked.set(key, annotated)
      else this.blocked.delete(key)
      options.onRecovery?.(uncertain ? '命令执行未完成，已保留原始结果；正在等待核对已完成的操作' : '命令执行失败，请根据原始错误继续处理')
      return annotated
    }
    this.blocked.delete(key)
    return originalError ? withCommandRecovery(result, { kind: 'runtime-access', state: 'recovered', execution: 'completed', attempts: 1, originalError, message: outside ? '已使用本次批准的完整本机权限执行，原命令只执行一次。' : '已自动改用项目内运行时，原操作只执行一次。' }) : result
  }
}
