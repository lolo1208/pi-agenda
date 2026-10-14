import { randomUUID } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SandboxBackend, SandboxState } from '../../shared/sandbox'
import { SANDBOX_CHECKS, SANDBOX_MESSAGES } from '../../shared/sandbox'
import { type TerminalSandbox } from './terminal-sandbox'
import { WindowsSandboxEngine } from './windows-sandbox-engine'
import { MacosSandboxEngine } from './macos-sandbox'
import { checkMacosSandboxIsolation } from './macos-sandbox-isolation-check'
import { SandboxVerificationStore } from './sandbox-verification-store'
import { ModelError } from './model-validation'
import { checkSandboxIsolation, checkCachedSandboxIsolation } from './sandbox-isolation-check'

export interface SandboxEngine extends TerminalSandbox {
  checkRuntime(): Promise<void>; reset(): void; setBackend(backend: SandboxBackend): void
  checkBackend?(backend: SandboxBackend): Promise<void>
  configureLegacy(signal?: AbortSignal): Promise<void>
  fingerprint?(project: string): Promise<string>
}
export class SandboxService implements TerminalSandbox {
  readonly failClosed = true
  private states = new Map<string, SandboxState>()
  private verified = new Set<string>()
  private readonly records: SandboxVerificationStore
  private operation?: { project: string; controller: AbortController; promise: Promise<void> }
  private readonly engine: SandboxEngine
  constructor(private readonly options: {
    runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[]; emit(state: SandboxState): void
    engine?: SandboxEngine; platform?: string; release?: string
    verify?: typeof checkSandboxIsolation
    verifyCached?: typeof checkCachedSandboxIsolation
    stepTimeoutMs?: number
  }) {
    this.records = new SandboxVerificationStore(options.dataDirectory)
    this.engine = options.engine ?? (this.platform === 'darwin' ? new MacosSandboxEngine(options) : new WindowsSandboxEngine(options))
  }
  private get platform(): string { return this.options.platform ?? process.platform }
  private compatible(backend: unknown): backend is SandboxBackend { return this.platform === 'darwin' ? backend === 'seatbelt' : this.platform === 'win32' && ['mxc', 'appcontainer'].includes(String(backend)) }
  get busy(): boolean { return !!this.operation }
  private get activeProject(): string | undefined { return this.operation?.project }
  /** 编辑项目路径时迁移同一项目的通过记录，不把打开其他项目当作迁移。 */
  async rebindProject(previous: string, project: string): Promise<void> {
    if (this.busy) throw new ModelError('安全执行环境正在准备，请完成后再修改项目路径')
    previous = await realpath(previous).catch(() => path.resolve(previous))
    project = await realpath(project)
    if (previous === project) return
    await this.records.rebind(previous, project)
    this.states.delete(previous); this.states.delete(project)
    this.verified.delete(previous); this.verified.delete(project)
  }
  async status(project: string): Promise<SandboxState> {
    project = await realpath(project)
    const current = this.states.get(project)
    if (current) return structuredClone(current)
    const { record, backend } = await this.records.restore(project, backend => this.compatible(backend))
    // 读取配置期间检查可能已开始或完成，不能再用初始状态覆盖进度。
    const latest = this.states.get(project)
    if (latest) return structuredClone(latest)
    const state: SandboxState = { project, backend, phase: record ? 'ready' : 'unconfigured', reused: !!record, operationId: '', steps: [], message: record ? SANDBOX_MESSAGES.reused : SANDBOX_MESSAGES.unconfigured, updatedAt: Date.now() }
    if (record) this.verified.add(project)
    this.states.set(project, state)
    return structuredClone(state)
  }
  private publish(state: SandboxState, starting = false): void {
    const existing = this.states.get(state.project)
    if (!starting && existing?.operationId && existing.operationId !== state.operationId) return
    state.updatedAt = Date.now(); this.states.set(state.project, state); this.options.emit(structuredClone(state))
  }
  async ensure(project: string): Promise<SandboxState> {
    const state = await this.status(project)
    if (state.phase === 'failed' || this.verified.has(state.project)) return state
    if (this.operation) return state.project === this.operation.project ? this.status(project) : state
    try { return await this.start(project, state.backend ? 'check' : 'configure') }
    catch (error) {
      // 多个页面状态请求可同时到达，共享正在进行的项目检查。
      if (this.activeProject === state.project) return this.status(project)
      throw error
    }
  }
  async start(project: string, action: 'configure' | 'diagnose' | 'check'): Promise<SandboxState> {
    if (this.operation) throw new ModelError('安全执行环境正在处理，请等待或停止当前检查')
    const initial = await this.status(project)
    // 路径解析期间可能已启动另一项检查，必须再次确认互斥状态。
    if (this.operation) throw new ModelError('安全执行环境正在处理，请等待或停止当前检查')
    this.verified.delete(initial.project)
    const controller = new AbortController()
    const state: SandboxState = { ...initial, reused: false, operationId: randomUUID(), phase: 'running', steps: [], message: action === 'diagnose' ? SANDBOX_MESSAGES.diagnosing : SANDBOX_MESSAGES.preparing }
    this.publish(state, true)
    const operation = { project: state.project, controller, promise: Promise.resolve() }
    this.operation = operation
    operation.promise = this.perform(state, action, controller).finally(() => { if (this.operation === operation) this.operation = undefined })
    return structuredClone(state)
  }
  async wait(): Promise<void> { await this.operation?.promise }
  private async waitForCheck(project: string, signal?: AbortSignal): Promise<void> {
    const operation = this.operation
    if (!operation) return
    if (operation.project !== project) throw new ModelError('另一个项目正在检查安全执行环境，终端命令暂不执行')
    let abort!: () => void
    const canceled = new Promise<never>((_resolve, reject) => { abort = () => reject(signal?.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort() })
    try { await Promise.race([operation.promise, canceled]) }
    finally { signal?.removeEventListener('abort', abort) }
  }
  stop(): void { this.operation?.controller.abort(new ModelError('已停止安全执行检查，自动终端执行保持关闭')) }
  private async perform(state: SandboxState, action: 'configure' | 'diagnose' | 'check', controller: AbortController): Promise<void> {
    const signal = controller.signal
    const overallTimer = setTimeout(() => controller.abort(new ModelError(`安全执行准备超时，停在“${state.message}”，请手动检查`)), 300000)
    const abortable = async <T>(operation: Promise<T>): Promise<T> => {
      let aborted!: () => void
      const interrupted = new Promise<never>((_resolve, reject) => { aborted = () => reject(signal.reason); signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted() })
      try { return await Promise.race([operation, interrupted]) }
      finally { signal.removeEventListener('abort', aborted) }
    }
    const check = async (id: string, label: string, task: () => Promise<void>): Promise<void> => {
      signal.throwIfAborted()
      const step = { id, label, status: 'running' as 'running' | 'passed' | 'failed', detail: undefined as string | undefined }
      state.steps.push(step); state.message = label; this.publish(state)
      const timeout = setTimeout(() => controller.abort(new ModelError(`“${label}”超过等待时间，请检查系统权限或隔离后端`)), this.options.stepTimeoutMs ?? 60000)
      let aborted!: () => void
      const interrupted = new Promise<never>((_resolve, reject) => { aborted = () => reject(signal.reason); signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted() })
      try { await Promise.race([task(), interrupted]); signal.throwIfAborted(); step.status = 'passed'; this.publish(state) }
      catch (error) { step.status = 'failed'; step.detail = error instanceof Error ? error.message : '检查未完成'; this.publish(state); throw error }
      finally { clearTimeout(timeout); signal.removeEventListener('abort', aborted) }
    }
    try {
      let backend: SandboxBackend = this.platform === 'darwin' ? 'seatbelt' : state.backend === 'elevated' ? 'appcontainer' : state.backend ?? (Number((this.options.release ?? os.release()).split('.')[2]) >= 26100 ? 'mxc' : 'appcontainer')
      state.backend = backend
      this.engine.reset()
      this.engine.setBackend(backend)
      await check('environment', SANDBOX_CHECKS.environment.label, async () => {
        if (!['win32', 'darwin'].includes(this.platform)) throw new ModelError('当前系统尚未接入安全执行后端，请选择 Windows 或 macOS 环境')
        try { await this.engine.checkRuntime() }
        catch (error) {
          signal.throwIfAborted()
          if (backend !== 'mxc') throw error
          backend = 'appcontainer'; state.backend = backend; this.engine.setBackend(backend)
          await this.engine.checkRuntime()
          state.steps.find(step => step.id === 'environment')!.detail = '原生运行时不可用，已选择内置兼容后端；随后继续完整边界测试。'
        }
      })
      await check('repair', action === 'diagnose' ? '自动恢复工作目录和执行配置，清除失效缓存' : SANDBOX_CHECKS.repair.label, async () => {
        await mkdir(this.options.dataDirectory, { recursive: true })
      })
      await check('compatibility', SANDBOX_CHECKS.compatibility.label, async () => { await this.engine.checkBackend?.(backend) })
      await check('launch', SANDBOX_CHECKS.launch.label, async () => {
        try { await this.engine.prepare(state.project, signal) }
        catch (error) {
          signal.throwIfAborted()
          if (backend !== 'mxc') throw error
          backend = 'appcontainer'; state.backend = backend; this.engine.setBackend(backend)
          await this.engine.checkRuntime(); await this.engine.checkBackend?.(backend)
          await this.engine.prepare(state.project, signal)
          state.steps.find(step => step.id === 'launch')!.detail = '原生隔离不可用，已自动使用兼容隔离。仍需通过完整边界测试。'
        }
      })
      await abortable((this.options.verify ?? (this.platform === 'darwin' ? checkMacosSandboxIsolation : checkSandboxIsolation))(this.engine, state.project, this.options.dataDirectory, signal, check))
      signal.throwIfAborted()
      await abortable(this.records.save(state.project, backend, signal))
      signal.throwIfAborted()
      this.verified.add(state.project)
      state.phase = 'ready'; state.message = SANDBOX_MESSAGES.ready; this.publish(state)
    } catch (error) {
      this.verified.delete(state.project); this.engine.reset()
      // 失败记录不能在下次启动时重新被当成有效缓存。
      await this.records.revoke(state.project).catch(() => {})
      state.phase = 'failed'; state.message = signal.aborted ? `${signal.reason instanceof Error ? signal.reason.message : '检查已停止'}。自动终端执行保持关闭。` : `${error instanceof Error ? error.message : '隔离测试失败'}。可排查问题，或明确切换到完全访问后执行。`
      this.publish(state)
    } finally { clearTimeout(overallTimer) }
  }
  async prepare(project: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    project = await realpath(project)
    await this.waitForCheck(project, signal)
    const state = await this.status(project)
    if (!this.verified.has(project) && state.phase !== 'failed') {
      // 所有后端均由同一流程在后台完成首次配置。
      {
        await this.ensure(project)
        await this.waitForCheck(project, signal)
      }
    }
    signal?.throwIfAborted()
    if (!this.verified.has(project)) { this.publish(this.states.get(project)!); throw new ModelError('安全执行环境尚未通过隔离测试；请完成配置、排查问题，或明确切换到完全访问') }
    try { this.engine.setBackend(this.states.get(project)!.backend!); await this.engine.prepare(project, signal) }
    catch (error) {
      if (signal?.aborted) throw error
      this.verified.delete(project)
      await this.records.revoke(project).catch(() => {})
      const current = this.states.get(project)!
      current.phase = 'failed'; current.message = `安全执行环境失效：${error instanceof Error ? error.message : '启动失败'}。请排查或切换到完全访问。`
      this.publish(current); throw error
    }
  }
  async exec(command: string, cwd: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    if (this.busy || !this.verified.has(cwd)) throw new ModelError('隔离测试尚未通过，终端命令已停止')
    this.engine.setBackend(this.states.get(cwd)!.backend!)
    const result = await this.engine.exec(command, cwd, options)
    return { exitCode: result.exitCode ?? 1 }
  }
}
