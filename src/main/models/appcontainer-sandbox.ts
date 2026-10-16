import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { ModelError } from './model-validation'
import { sandboxEnvironment, type TerminalSandbox } from './terminal-sandbox'
import { prepareSandboxConfiguration } from './sandbox-configuration'
import { retryableGitInspection } from './git-working-directory-check'
import { findHostRuntime } from './windows-command-recovery'
import { SandboxCompatibilityError } from './sandbox-compatibility-error'

/** 原生 argv 引用规则，不经 PowerShell 解释。 */
function nativeArgument(value: string): string {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
}

/** Windows 10 的 LPAC 后端。每次命令使用独立身份，仅向当前项目及临时目录授权。 */
export class AppContainerSandbox implements TerminalSandbox {
  private checked?: Promise<void>
  constructor(private readonly options: { runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[] }) {}
  private get executable(): string { return path.join(this.options.runtimeDirectory, 'bin/pi-agenda-appcontainer.exe') }
  reset(): void { this.checked = undefined }
  async checkRuntime(): Promise<void> {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new ModelError('AppContainer 后端需要 Windows x64')
    this.checked ??= (async () => {
      const manifest = JSON.parse(await readFile(path.join(this.options.runtimeDirectory, 'appcontainer-manifest.json'), 'utf8'))
      const sourceHash = createHash('sha256').update(await readFile(path.join(this.options.runtimeDirectory, 'AppContainerRunner.cs'))).digest('hex')
      if (manifest.version !== 1 || manifest.source !== sourceHash) throw new Error('隔离宿主源码校验失败')
      const hash = createHash('sha256'); for await (const chunk of createReadStream(this.executable)) hash.update(chunk)
      if (hash.digest('hex') !== manifest.executable) throw new Error('隔离宿主校验失败')
    })()
    try { await this.checked } catch { this.checked = undefined; throw new ModelError('AppContainer 隔离宿主缺失或校验失败，请恢复应用内置运行时') }
  }
  async prepare(project: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); await this.checkRuntime()
    if (await realpath(project) !== project || path.parse(project).root === project) throw new ModelError('项目路径发生变化或是整个盘符，不能配置 AppContainer')
  }
  async exec(command: string, project: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    if (retryableGitInspection(command)) {
      const deadline = options.timeout === undefined ? undefined : Date.now() + options.timeout * 1000
      for (const line of command.trim().split(/;|\r?\n/).map(value => value.trim()).filter(Boolean)) {
        options.signal?.throwIfAborted()
        const argv = line.split(/[ \t]+/).slice(1)
        if (argv[0] === 'diff') argv.splice(1, 0, '--no-ext-diff', '--no-textconv')
        const timeout = deadline === undefined ? undefined : Math.max(0, (deadline - Date.now()) / 1000)
        if (timeout === 0) throw new ModelError('Git 组合查询执行超时，已停止剩余查询')
        const result = await this.execGit(project, argv, { ...options, timeout })
        if (result.exitCode !== 0) return result
      }
      return { exitCode: 0 }
    }
    await this.prepare(project, options.signal)
    const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pi-agenda-ac-')))
    await prepareSandboxConfiguration(scratch)
    const moniker = 'pi-agenda.' + randomUUID().replace(/-/g, '')
    const protect = [...this.options.protectedDirectories, this.options.runtimeDirectory, ...['.git', '.agents', '.codex', '.aws', '.pi-agenda'].map(name => path.join(project, name))]
    const cwd = project.replace(/'/g, "''")
    const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; try { New-PSDrive -Name Project -PSProvider FileSystem -Root '${cwd}' | Out-Null; Set-Location -LiteralPath 'Project:\\'; [Environment]::CurrentDirectory='${cwd}'; & {\n${command}\n}; if (-not $?) { exit 1 }; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`
    try {
      return await this.run([moniker, project, scratch, Buffer.from(script, 'utf16le').toString('base64'), ...protect], scratch, options)
    } finally {
      // 使用新宿主清理权限，强制停止的旧宿主不能执行 finally；清理不执行用户脚本。
      await this.run([moniker, project, scratch, 'cleanup'], scratch, { timeout: 30, onData: () => {} }).catch(() => {})
      if (await realpath(scratch).catch(() => '') === scratch && path.basename(scratch).startsWith('pi-agenda-ac-')) await rm(scratch, { recursive: true, force: true })
    }
  }
  private async gitExecutable(project: string): Promise<string | undefined> {
    const executable = await findHostRuntime('git', project)
    if (!executable) return undefined
    // cmd/bin 的 Git 是包装程序，真正的 Git 进程需要在恢复线程之前设置私有映射。
    for (const architecture of ['mingw64', 'mingw32']) {
      const candidate = path.resolve(path.dirname(executable), '..', architecture, 'bin/git.exe')
      try { if ((await stat(candidate)).isFile()) return candidate } catch { /* 继续检查其他安装布局。 */ }
    }
    if (path.extname(executable).toLowerCase() !== '.exe') throw new ModelError('未找到可直接启动的 git.exe，请检查 Git 安装路径')
    return executable
  }
  async checkGitWorkingDirectory(project: string, signal?: AbortSignal): Promise<void> {
    if (!await this.gitExecutable(project)) return
    let output = ''
    const result = await this.execGit(project, ['status', '--porcelain', '--untracked-files=no'], { signal, timeout: 30, onData: data => { output = (output + data.toString('utf8')).slice(-8000) } }, true)
    if (result.exitCode !== 0) throw new SandboxCompatibilityError(`AppContainer 私有项目入口中的 Git 启动检查失败，用户命令尚未执行：${output.trim() || '未收到有效退出状态'}`)
  }
  private async execGit(project: string, argv: string[], options: Parameters<TerminalSandbox['exec']>[2], probe = false): Promise<{ exitCode: number }> {
    await this.prepare(project, options.signal)
    const git = await this.gitExecutable(project)
    if (!git) throw new ModelError('本机 PATH 中未找到 Git，请安装或配置 Git 后重试')
    const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pi-agenda-ac-')))
    const moniker = 'pi-agenda.' + randomUUID().replace(/-/g, '')
    const protect = [...this.options.protectedDirectories, this.options.runtimeDirectory, ...['.git', '.agents', '.codex', '.aws', '.pi-agenda'].map(name => path.join(project, name))]
    try {
      await prepareSandboxConfiguration(scratch)
      const argumentsList = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']
      if (probe) {
        const repository = path.join(scratch, 'probe.git')
        await mkdir(path.join(repository, 'objects'), { recursive: true }); await mkdir(path.join(repository, 'refs'))
        await writeFile(path.join(repository, 'HEAD'), 'ref: refs/heads/probe\n')
        await writeFile(path.join(repository, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n')
        argumentsList.push(`--git-dir=${repository}`, '--work-tree=.')
      }
      const payload = 'git:' + Buffer.from(git + '\n' + [...argumentsList, ...argv].map(nativeArgument).join(' '), 'utf16le').toString('base64')
      return await this.run([moniker, project, scratch, payload, ...protect], scratch, options)
    } finally {
      await this.run([moniker, project, scratch, 'cleanup'], scratch, { timeout: 30, onData: () => {} }).catch(() => {})
      if (await realpath(scratch).catch(() => '') === scratch && path.basename(scratch).startsWith('pi-agenda-ac-')) await rm(scratch, { recursive: true, force: true })
    }
  }
  private run(args: string[], scratch: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) { reject(options.signal.reason); return }
      const child = spawn(this.executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: sandboxEnvironment(this.options.dataDirectory, scratch) })
      let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined
      const terminate = (): void => {
        if (!child.pid) return
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.once('error', () => { child.kill() })
      }
      const cleanup = (): void => { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', terminate) }
      child.stdout.on('data', options.onData); child.stderr.on('data', options.onData)
      child.once('error', error => { cleanup(); reject(new ModelError(`AppContainer 启动失败：${error.message}`)) })
      child.once('close', code => { cleanup(); if (options.signal?.aborted) reject(options.signal.reason); else if (timedOut) reject(new ModelError('AppContainer 命令执行超时')); else resolve({ exitCode: code ?? 1 }) })
      options.signal?.addEventListener('abort', terminate, { once: true }); if (options.signal?.aborted) terminate()
      if (options.timeout !== undefined) timer = setTimeout(() => { timedOut = true; terminate() }, options.timeout * 1000)
    })
  }
}
