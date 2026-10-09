import type { ModelDescriptor } from '../../shared/models'
import { asRecord, ModelError, normalizeOllamaUrl, requiredString } from './model-validation'

/** 读取有大小和超时限制的 JSON，避免模型元数据拖住主进程。 */
export async function readModelJson(response: Response, limit = 2 * 1024 * 1024): Promise<Record<string, unknown>> {
  if (!response.body) throw new ModelError('模型服务返回空响应')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > limit) throw new ModelError('模型服务响应过大，请减少模型列表或输出长度')
      chunks.push(result.value)
    }
    return asRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
function descriptor(id: string, data: Record<string, unknown>): ModelDescriptor {
  const details = data.details && typeof data.details === 'object' ? asRecord(data.details) : {}
  const info = data.model_info && typeof data.model_info === 'object' ? asRecord(data.model_info) : {}
  const architecture = info['general.architecture']
  const context = (typeof architecture === 'string' ? info[`${architecture}.context_length`] : undefined) ?? details.context_length ?? Object.entries(info).find(([key]) => key.endsWith('.context_length'))?.[1]
  return {
    id, capabilities: Array.isArray(data.capabilities) ? data.capabilities.filter((item): item is string => typeof item === 'string').slice(0, 30) : [],
    maxContextTokens: typeof context === 'number' && Number.isSafeInteger(context) && context > 0 ? context : null,
    sizeBytes: typeof data.size === 'number' && data.size >= 0 ? data.size : undefined,
    parameterSize: typeof details.parameter_size === 'string' ? details.parameter_size.slice(0, 80) : undefined,
    quantization: typeof details.quantization_level === 'string' ? details.quantization_level.slice(0, 80) : undefined
  }
}
export class OllamaClient {
  constructor(private readonly fetchRequest: typeof fetch = fetch) {}
  private async request(baseUrl: unknown, endpoint: string, body?: unknown): Promise<Record<string, unknown>> {
    const root = normalizeOllamaUrl(baseUrl)
    const signal = AbortSignal.timeout(10000)
    try {
      const response = await this.fetchRequest(`${root}/api/${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ModelError(`Ollama 返回 HTTP ${response.status}，请检查服务地址和模型是否存在`)
      }
      return await readModelJson(response)
    } catch (error) {
      if (signal.aborted) throw new ModelError('读取 Ollama 超时，请确认本地服务正在运行后重试')
      if (error instanceof ModelError) throw error
      throw new ModelError('无法读取 Ollama，请检查本地服务、地址与响应格式后重试')
    }
  }
  async list(baseUrl: unknown): Promise<ModelDescriptor[]> {
    const data = await this.request(baseUrl, 'tags')
    if (!Array.isArray(data.models) || data.models.length > 200) throw new ModelError('Ollama 模型列表格式无效或超过 200 个模型')
    const models = data.models.map(value => { const item = asRecord(value); return descriptor(requiredString(item.name ?? item.model, '模型名称', 200), item) })
    return [...new Map(models.map(item => [item.id, item])).values()]
  }
  async info(baseUrl: unknown, model: unknown): Promise<ModelDescriptor> {
    const id = requiredString(model, '模型名称', 200)
    return descriptor(id, await this.request(baseUrl, 'show', { model: id }))
  }
}
