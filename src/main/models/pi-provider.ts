import { InMemoryCredentialStore, type Api, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ModelProfile, ModelRateLimit } from '../../shared/models'
import type { PiAttachments } from './pi-attachments'
import { ollamaFetch } from './pi-ollama'
import { safePiStream } from './pi-stream'
import type { ChatgptService } from './chatgpt-service'
import { ModelError } from './model-validation'

export async function createPiProvider(profile: ModelProfile, apiKey: string, attachments: PiAttachments, responses: boolean, onLimits: (limits: ModelRateLimit[]) => void, fetchRequest: typeof fetch = fetch, chatgpt?: ChatgptService) {
  if (profile.provider === 'chatgpt') {
    if (!chatgpt) throw new ModelError('ChatGPT 订阅服务尚未初始化，请重启应用')
    return chatgpt.createProvider(profile, attachments)
  }
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false })
  const provider = `pi-agenda-${profile.id}`
  const api = profile.protocol === 'anthropic' ? 'anthropic-messages' : responses ? 'openai-responses' : 'openai-completions'
  const implementation = api === 'anthropic-messages' ? anthropicMessagesApi() : responses ? openAIResponsesApi() : openAICompletionsApi()
  const securedFetch: typeof fetch = (url, init) => {
    const headers = new Headers(init?.headers)
    if (!apiKey) { headers.delete('authorization'); headers.delete('x-api-key') }
    return fetchRequest(url, { ...init, headers, redirect: 'error' })
  }
  runtime.registerProvider(provider, {
    api, baseUrl: profile.baseUrl, apiKey: apiKey || 'pi-agenda-local',
    models: [{ id: profile.model, name: profile.name, input: ['text', 'image'], reasoning: profile.thinking === true,
      contextWindow: profile.contextTokens ?? Math.max(32768, profile.maxTokens * 2), maxTokens: profile.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(api === 'openai-completions' ? { compat: { maxTokensField: profile.tokenParameter, supportsDeveloperRole: profile.provider === 'openai', supportsStore: false, supportsReasoningEffort: profile.provider === 'openai' } } : {}) }],
    streamSimple: (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
      const controller = new AbortController()
      return safePiStream(implementation.streamSimple(model, context, {
      ...options, apiKey: apiKey || 'pi-agenda-local', maxTokens: profile.maxTokens,
      signal: options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      ...(profile.temperature !== null ? { temperature: profile.temperature } : {}),
      timeoutMs: profile.timeoutSeconds * 1000, maxRetries: 0,
      fetch: profile.provider === 'ollama' ? ollamaFetch(profile, securedFetch) : securedFetch,
      onPayload: async (payload, target) => {
        const modified = await options?.onPayload?.(payload, target) ?? payload
        const body = attachments.replacePayload(modified, profile.provider === 'ollama' ? { ...profile, provider: 'custom' } : profile, responses) as Record<string, unknown>
        if (responses) body.store = false
        if (profile.temperature === null) delete body.temperature
        return body
      },
      onResponse: async (response, target) => {
        await options?.onResponse?.(response, target)
        if (profile.provider !== 'openai') return
        const headers = new Headers(response.headers)
        const limits: ModelRateLimit[] = []
        for (const kind of ['requests', 'tokens'] as const) {
          const limit = Number(headers.get(`x-ratelimit-limit-${kind}`))
          const remainingText = headers.get(`x-ratelimit-remaining-${kind}`)
          const remaining = Number(remainingText)
          if (Number.isSafeInteger(limit) && limit > 0 && remainingText && Number.isSafeInteger(remaining) && remaining >= 0 && remaining <= limit) limits.push({ kind, limit, remaining, reset: headers.get(`x-ratelimit-reset-${kind}`) ?? undefined })
        }
        onLimits(limits)
      }
    }), apiKey, () => controller.abort())
    }
  })
  return { runtime, model: runtime.getModel(provider, profile.model)!, thinkingLevel: profile.thinking === true || profile.ollamaThinkingLevel != null ? 'medium' as const : 'off' as const }
}
