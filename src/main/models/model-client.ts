import type { ChatMessage, ModelProfile, ModelReply } from '../../shared/models'
import { asRecord, ModelError } from './model-validation'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export class ModelClient {
  constructor(private readonly fetchRequest: typeof fetch = fetch) {}

  async complete(profile: ModelProfile, apiKey: string, messages: ChatMessage[], signal: AbortSignal): Promise<ModelReply> {
    const startedAt = performance.now()
    const isAnthropic = profile.protocol === 'anthropic'
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (isAnthropic) {
      headers['anthropic-version'] = '2023-06-01'
      if (apiKey) headers['x-api-key'] = apiKey
    } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const body: Record<string, unknown> = {
      model: profile.model, messages, stream: false,
      [isAnthropic ? 'max_tokens' : profile.tokenParameter]: profile.maxTokens
    }
    if (profile.temperature !== null) body.temperature = profile.temperature
    let response: Response
    try {
      response = await this.fetchRequest(`${profile.baseUrl}/${isAnthropic ? 'messages' : 'chat/completions'}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error'
      })
    } catch {
      if (signal.aborted) throw new ModelError('请求已取消或超时')
      throw new ModelError('无法连接模型服务，请检查 Base URL、网络或代理；服务重定向不会被自动跟随')
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      const hints: Record<number, string> = {
        400: '请求参数不受支持，请检查模型、Token 参数与 Temperature',
        401: '认证失败，请检查 API Key', 403: '没有访问权限，请检查密钥和模型授权',
        404: '接口或模型不存在，请检查 Base URL 和模型 ID',
        429: '请求过于频繁或额度不足，请检查服务额度后重试'
      }
      // Never echo provider error bodies: gateways can reflect headers or credentials.
      throw new ModelError(`模型服务返回 HTTP ${response.status}：${hints[response.status] ?? '服务暂时不可用，请稍后重试'}`)
    }
    try {
      if (!response.body) throw new ModelError('模型服务返回空响应')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) break
          length += result.value.byteLength
          if (length > MAX_RESPONSE_BYTES) throw new ModelError('模型响应超过 2 MiB 上限，请降低输出 Token 上限')
          chunks.push(result.value)
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
      const result = asRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      let text: string
      let truncated: boolean
      if (isAnthropic) {
        if (!Array.isArray(result.content)) throw new Error()
        text = result.content.map(value => asRecord(value)).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
        truncated = result.stop_reason === 'max_tokens'
      } else {
        if (!Array.isArray(result.choices) || !result.choices.length) throw new Error()
        const choice = asRecord(result.choices[0])
        const message = asRecord(choice.message)
        if (typeof message.content !== 'string') throw new Error()
        text = message.content
        truncated = choice.finish_reason === 'length'
      }
      if (!text.trim()) throw new ModelError('模型未返回文本，请检查模型能力或提高输出 Token 上限')
      if (apiKey) text = text.split(apiKey).join('[已隐藏密钥]')
      return { text, model: profile.model, elapsedMs: Math.round(performance.now() - startedAt), truncated }
    } catch (error) {
      if (signal.aborted) throw new ModelError('请求已取消或超时')
      if (error instanceof ModelError) throw error
      throw new ModelError('模型响应格式不符合所选协议，请检查服务配置')
    }
  }
}
