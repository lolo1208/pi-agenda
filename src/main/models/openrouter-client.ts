import { parseThinkingControls, type ModelDescriptor, type OpenrouterUsage } from '../../shared/models'
import { openrouterPricing } from '../../shared/model-pricing'
import { OPENROUTER_BASE_URL } from '../../shared/openrouter'
import { asRecord, ModelError, requiredString } from './model-validation'
import { readModelJson } from './ollama-client'

export class OpenrouterClient {
  constructor(private readonly fetchRequest: typeof fetch = fetch) {}
  async usage(apiKey: string): Promise<OpenrouterUsage> {
    const signal = AbortSignal.timeout(15000)
    try {
      const response = await this.fetchRequest(`${OPENROUTER_BASE_URL}/key`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal, redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ModelError(response.status === 401 ? 'OpenRouter API Key 无效，请重新配置连接' : `OpenRouter 额度读取失败（HTTP ${response.status}），将自动重试`)
      }
      const data = asRecord((await readModelJson(response, 1024 * 1024)).data)
      const amount = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
      const daily = data.free_model_daily_requests && typeof data.free_model_daily_requests === 'object' ? asRecord(data.free_model_daily_requests) : {}
      const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      return {
        fetchedAt: Date.now(),
        limit: data.limit === null ? null : amount(data.limit),
        remaining: data.limit_remaining === null ? null : amount(data.limit_remaining),
        dailySpend: amount(data.usage_daily),
        ...(count(daily.used) && count(daily.limit) && count(daily.remaining) ? { freeDaily: { used: daily.used, limit: daily.limit, remaining: daily.remaining } } : {}),
      }
    } catch (error) {
      if (signal.aborted) throw new ModelError('OpenRouter 额度读取超时，将自动重试')
      if (error instanceof ModelError) throw error
      throw new ModelError('无法读取 OpenRouter 额度，请检查网络后重试')
    }
  }
  async list(apiKey: string): Promise<ModelDescriptor[]> {
    const signal = AbortSignal.timeout(30000)
    try {
      const request = async (endpoint: string, limit: number) => {
        const response = await this.fetchRequest(`${OPENROUTER_BASE_URL}/${endpoint}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal, redirect: 'error',
        })
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined)
          const reason = response.status === 401 ? 'API Key 无效，请重新输入' : response.status === 402 ? '账户余额不足' : response.status === 429 ? '请求过于频繁，请稍后重试' : '请检查账号权限或稍后重试'
          throw new ModelError(`OpenRouter 返回 HTTP ${response.status}：${reason}`)
        }
        return readModelJson(response, limit)
      }
      // 公共目录本身不验证密钥，先检查当前密钥，避免无效密钥被当作连接成功。
      const auth = asRecord((await request('key', 1024 * 1024)).data)
      if (auth.is_management_key === true || auth.is_provisioning_key === true) throw new ModelError('请使用可调用模型的 OpenRouter API Key，不能使用管理密钥')
      const data = await request('models', 16 * 1024 * 1024)
      if (!Array.isArray(data.data) || data.data.length > 5000) throw new ModelError('OpenRouter 模型目录格式无效或超过 5,000 条')
      const models: ModelDescriptor[] = []
      const checkedAt = new Date().toISOString()
      for (const value of data.data) {
        const item = asRecord(value)
        const architecture = asRecord(item.architecture ?? {})
        if (!Array.isArray(architecture.output_modalities) || !architecture.output_modalities.includes('text')) continue
        const inputs = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : []
        if (!inputs.includes('text') || /:batch$/.test(String(item.id))) continue
        const parameters = Array.isArray(item.supported_parameters) ? item.supported_parameters.filter((x): x is string => typeof x === 'string').slice(0, 100) : []
        const top = asRecord(item.top_provider ?? {})
        const reasoning = asRecord(item.reasoning ?? {})
        const efforts = Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts.filter(x => ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(x))) : []
        const thinking = efforts.length ? parseThinkingControls({ values: [...(reasoning.mandatory === false ? ['off'] : []), ...efforts], default: reasoning.default_effort }) : undefined
        models.push({ id: requiredString(item.id, '模型 ID', 200), name: typeof item.name === 'string' ? item.name.slice(0, 200) : undefined,
          created: typeof item.created === 'number' && Number.isSafeInteger(item.created) ? item.created : undefined,
          maxContextTokens: typeof item.context_length === 'number' && Number.isSafeInteger(item.context_length) && item.context_length > 0 ? item.context_length : null,
          maxOutputTokens: typeof top.max_completion_tokens === 'number' && Number.isSafeInteger(top.max_completion_tokens) && top.max_completion_tokens > 0 ? top.max_completion_tokens : undefined,
          supportedParameters: parameters, capabilities: ['completion', ...(parameters.includes('tools') ? ['tools'] : []), ...(inputs.includes('image') ? ['vision'] : []), ...(architecture.output_modalities.includes('image') ? ['image-generation'] : []), ...(parameters.includes('reasoning') ? ['thinking'] : [])],
          ...(thinking ? { thinking } : {}),
          pricing: openrouterPricing(item.pricing, checkedAt),
        })
      }
      if (!models.length) throw new ModelError('OpenRouter 未返回可调用的文本模型，请稍后刷新目录')
      return [...new Map(models.map(model => [model.id, model])).values()]
    } catch (error) {
      if (signal.aborted) throw new ModelError('读取 OpenRouter 模型目录超时，请检查网络后重试')
      if (error instanceof ModelError) throw error
      throw new ModelError('无法读取 OpenRouter 模型目录，请检查网络、代理和响应格式后重试')
    }
  }
}
