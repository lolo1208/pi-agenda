import type { ModelReply, ModelResult } from '../../shared/models'
import { ModelClient } from './model-client'
import { ModelSettingsStore } from './model-settings-store'
import { ModelError, parseMessages, profileId } from './model-validation'

export async function modelResult<T>(action: () => Promise<T>): Promise<ModelResult<T>> {
  try { return { ok: true, value: await action() } }
  catch (error) { return { ok: false, error: error instanceof ModelError ? error.message : '模型操作失败，请检查配置后重试' } }
}

export class ModelService {
  private pending: { id: string; controller: AbortController } | null = null
  constructor(private readonly store: ModelSettingsStore, private readonly client = new ModelClient()) {}

  async request(id: unknown, requestId: unknown, messages: unknown, isTest: boolean): Promise<ModelReply> {
    const operationId = profileId(requestId)
    if (this.pending) throw new ModelError('已有模型请求运行，请等待完成或取消')
    const controller = new AbortController()
    this.pending = { id: operationId, controller }
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
      const config = await this.store.getForRequest(id)
      const conversation = isTest ? [{ role: 'user' as const, content: 'Reply with OK.' }] : parseMessages(messages)
      controller.signal.throwIfAborted()
      timer = setTimeout(() => { timedOut = true; controller.abort() }, config.profile.timeoutSeconds * 1000)
      const result = await this.client.complete(config.profile, config.apiKey, conversation, controller.signal)
      controller.signal.throwIfAborted()
      return result
    } catch (error) {
      if (controller.signal.aborted) throw new ModelError(timedOut ? '模型请求超时，请检查服务或增加超时秒数' : '模型请求已取消')
      throw error
    } finally { if (timer) clearTimeout(timer); this.pending = null }
  }

  cancel(requestId: unknown): Promise<void> {
    const operationId = profileId(requestId)
    if (this.pending?.id === operationId) this.pending.controller.abort()
    return Promise.resolve()
  }
  cancelAll(): void { this.pending?.controller.abort() }
}
