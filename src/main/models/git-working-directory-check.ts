import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { TerminalSandbox } from './terminal-sandbox'
import { ModelError } from './model-validation'
import { SandboxCompatibilityError } from './sandbox-compatibility-error'

const failureMarker = 'PI_AGENDA_GIT_CWD_FAILED'

/** 只识别 Git 自身的完整错误行，不把普通拒绝访问或仓库错误当成后端故障。 */
export function gitWorkingDirectoryDenied(output: string): boolean {
  return /(?:^|\r?\n)fatal: Unable to read current working directory: Permission denied\r?(?:\n|$)/.test(output)
}

/** 严格限制可自动重试的脚本，不接受参数扩展、重定向、管道或任意其他命令。 */
export function retryableGitInspection(command: string): boolean {
  if (command.length > 1024) return false
  const lines = command.trim().split(/;|\r?\n/).map(line => line.trim()).filter(Boolean)
  return lines.length > 0 && lines.length <= 3 && lines.every(line => /^git(?:\.exe)?[ \t]+(?:status[ \t]+--short|diff[ \t]+(?:--no-ext-diff|--stat|--cached[ \t]+--stat)|rev-parse[ \t]+--show-toplevel)$/.test(line))
}

/** 在真实项目 cwd 验证 Git；探针仓库仅存在于隔离进程的临时区，不扫描用户文件。 */
export async function checkGitWorkingDirectory(sandbox: Pick<TerminalSandbox, 'exec' | 'checkGitWorkingDirectory'>, project: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (sandbox.checkGitWorkingDirectory) return sandbox.checkGitWorkingDirectory(project, signal)
  // 命令查找会把“安装目录不可读”表现为“未安装”；宿主能定位 Git 时不能静默跳过。
  const candidates = (process.env.PATH ?? '').split(path.delimiter).map(entry => entry.trim().replace(/^"|"$/g, '')).filter(Boolean)
  const hostHasGit = (await Promise.all(candidates.map(async directory => {
    try { return (await stat(path.resolve(project, directory, 'git.exe'))).isFile() } catch { return false }
  }))).some(Boolean)
  signal?.throwIfAborted()
  const token = randomUUID(), marker = `pi-agenda-git-cwd-${token}`
  const literalProject = "'" + project.replace(/'/g, "''") + "'"
  const command = `$gitCommand=Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $gitCommand -and $${hostHasGit ? 'true' : 'false'}) { throw '${failureMarker}: 宿主 PATH 中可定位 Git，但隔离进程无法访问 Git 可执行程序' }; if ($gitCommand) {
  $gitProbe=[IO.Path]::Combine($env:TEMP,'git-cwd-${token}.git')
  try {
    [IO.Directory]::CreateDirectory([IO.Path]::Combine($gitProbe,'objects')) | Out-Null
    [IO.Directory]::CreateDirectory([IO.Path]::Combine($gitProbe,'refs')) | Out-Null
    [IO.File]::WriteAllText([IO.Path]::Combine($gitProbe,'HEAD'),"ref: refs/heads/probe\n")
    [IO.File]::WriteAllText([IO.Path]::Combine($gitProbe,'config'),"[core]\nrepositoryformatversion = 0\nbare = false\n")
    & $gitCommand.Source --no-optional-locks --git-dir=$gitProbe --work-tree=${literalProject} -c core.fsmonitor=false -c core.untrackedCache=false status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0) { throw '${failureMarker}: Git 工作目录兼容性检查失败' }
  } finally { if ([IO.Directory]::Exists($gitProbe)) { [IO.Directory]::Delete($gitProbe,$true) } }
}; Write-Output '${marker}'`
  let output = ''
  const result = await sandbox.exec(command, project, { signal, timeout: 30, onData: data => { output = (output + data.toString('utf8')).slice(-8000) } })
  if (result.exitCode === 0 && output.includes(marker)) return
  const message = `Windows 系统沙箱启动检查失败，用户命令尚未执行：${output.trim().slice(0, 2000) || '未收到有效探针结果'}`
  if (output.includes(failureMarker) || gitWorkingDirectoryDenied(output)) throw new SandboxCompatibilityError(message)
  throw new ModelError(message)
}
