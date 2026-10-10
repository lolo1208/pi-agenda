import { MAX_CUSTOM_PROMPT_LENGTH, type AgentRequestOptions, type ModelDescriptor, type ModelReply, type ModelResult, type ModelSettings } from '../../shared/models'
import { PiAgentService } from './pi-agent-service'
import { OllamaClient } from './ollama-client'
import { ModelClient } from './model-client'
import { ModelSettingsStore } from './model-settings-store'
import { ModelError, parseMessages, profileId } from './model-validation'
import { compactContext } from './context-compaction'
import type { ContextOptions } from '../../shared/context'

export async function modelResult<T>(action: () => Promise<T>): Promise<ModelResult<T>> {
  try { return { ok: true, value: await action() } }
  catch (error) { return { ok: false, error: error instanceof ModelError ? error.message : '模型操作失败，请检查配置后重试' } }
}

export class ModelService {
  private pending: { id: string; controller: AbortController } | null = null
  constructor(private readonly store: ModelSettingsStore, private readonly client: PiAgentService | ModelClient, private readonly ollama = new OllamaClient()) {}
  history(id: unknown) { return this.client instanceof PiAgentService ? this.client.history(profileId(id)) : Promise.resolve(null) }
  removeHistory(id: string) { return this.client instanceof PiAgentService ? this.client.remove(id) : Promise.resolve() }
  isBusy(): boolean { return this.pending !== null }
  async connectOllama(baseUrl: unknown): Promise<ModelSettings> {
    const models = await this.ollama.list(baseUrl)
    return this.store.syncOllama(baseUrl, models)
  }
  getOllamaModelInfo(baseUrl: unknown, model: unknown): Promise<ModelDescriptor> { return this.ollama.info(baseUrl, model) }

  async request(id: unknown, requestId: unknown, messages: unknown, isTest: boolean, customPrompt?: unknown, context?: unknown, agent?: unknown): Promise<ModelReply> {
    const operationId = profileId(requestId)
    if (this.pending) throw new ModelError('已有模型请求运行，请等待完成或取消')
    const controller = new AbortController()
    this.pending = { id: operationId, controller }
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
      const config = await this.store.getForRequest(id)
      const conversation = isTest ? [{ role: 'user' as const, content: 'Reply with OK.' }] : parseMessages(messages)
      if (!isTest && customPrompt !== undefined && (typeof customPrompt !== 'string' || customPrompt.length > MAX_CUSTOM_PROMPT_LENGTH)) throw new ModelError(`自定义提示词必须为文本且不能超过 ${MAX_CUSTOM_PROMPT_LENGTH} 个字符`)
      const instruction = !isTest && typeof customPrompt === 'string' ? customPrompt.trim() : ''
      let agentOptions: AgentRequestOptions | undefined
      if (agent !== undefined) {
        const value = agent as AgentRequestOptions
        if (!value || typeof value !== 'object' || (value.project != null && (typeof value.project !== 'string' || value.project.length > 4096))) throw new ModelError('代理会话参数无效')
        agentOptions = { conversationId: profileId(value.conversationId), project: value.project }
      }
      if (context !== undefined) {
        const value = context as ContextOptions
        if (!value || typeof value !== 'object' || !Number.isInteger(value.threshold) || value.threshold < 60 || value.threshold > 95 || (value.usage !== undefined && (!value.usage || ![value.usage.inputTokens, value.usage.outputTokens].every(count => Number.isSafeInteger(count) && count >= 0)))) throw new ModelError('上下文压缩参数无效，阈值须为 60%–95%')
      }
      controller.signal.throwIfAborted()
      timer = setTimeout(() => { timedOut = true; controller.abort() }, config.profile.timeoutSeconds * 1000)
      if (this.client instanceof PiAgentService) return await this.client.run(config.profile, config.apiKey, conversation, controller.signal, instruction, context as ContextOptions | undefined, agentOptions, operationId, isTest)
      const prepared = isTest ? { messages: conversation } : await compactContext(this.client, config.profile, config.apiKey, conversation, controller.signal, instruction, context as ContextOptions | undefined)
      const result = await this.client.complete(config.profile, config.apiKey, prepared.messages, controller.signal, instruction)
      controller.signal.throwIfAborted()
      return { ...result, ...('compaction' in prepared && prepared.compaction ? { compaction: prepared.compaction } : {}) }
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
