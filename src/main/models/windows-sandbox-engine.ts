import type { SandboxBackend } from '../../shared/sandbox'
import { NativeTerminalSandbox, type TerminalSandbox } from './terminal-sandbox'
import { AppContainerSandbox } from './appcontainer-sandbox'
import { sandboxVerificationFingerprint } from './sandbox-verification-fingerprint'
import { ModelError } from './model-validation'

/** 不同 Windows 版本共用真实检测与错误处理，不再启动要求全盘读取的旧兼容后端。 */
export class WindowsSandboxEngine implements TerminalSandbox {
  private backend: SandboxBackend = 'mxc'
  private native: NativeTerminalSandbox
  private appcontainer: AppContainerSandbox
  constructor(private readonly options: { runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[] }) {
    this.native = new NativeTerminalSandbox(options); this.appcontainer = new AppContainerSandbox(options)
  }
  private get selected(): NativeTerminalSandbox | AppContainerSandbox { return this.backend === 'mxc' ? this.native : this.appcontainer }
  setBackend(backend: SandboxBackend): void {
    if (backend === 'seatbelt') throw new ModelError('Windows 不能使用 macOS 隔离后端')
    this.backend = backend === 'elevated' ? 'appcontainer' : backend
  }
  reset(): void { this.native.reset(); this.appcontainer.reset() }
  checkRuntime(): Promise<void> { return this.selected.checkRuntime() }
  fingerprint(project: string): Promise<string> { return sandboxVerificationFingerprint(this.options, this.backend, project) }
  async checkBackend(backend: SandboxBackend): Promise<void> { if (backend === 'mxc') await this.native.checkBackend('mxc') }
  async configureLegacy(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); this.setBackend('appcontainer'); await this.checkRuntime() }
  prepare(project: string, signal?: AbortSignal): Promise<void> { return this.selected.prepare(project, signal) }
  exec(command: string, cwd: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> { return this.selected.exec(command, cwd, options) }
}
