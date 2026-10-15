/** 单价统一使用美元／百万 Token；等级只用于比较，不代表实际账单。 */
export interface ModelPricing {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  kind: 'catalog' | 'api-reference' | 'local' | 'cloud'
  source: string
  checkedAt: string
}

export function parseModelPricing(value: unknown): ModelPricing | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (typeof item.input !== 'number' || !Number.isFinite(item.input) || item.input < 0
    || typeof item.output !== 'number' || !Number.isFinite(item.output) || item.output < 0
    || !['catalog', 'api-reference', 'local', 'cloud'].includes(String(item.kind))
    || typeof item.source !== 'string' || item.source.length > 300
    || typeof item.checkedAt !== 'string' || !Number.isFinite(Date.parse(item.checkedAt))) return undefined
  if (item.kind === 'local' && (item.input !== 0 || item.output !== 0)) return undefined
  const optionalPrice = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  return { input: item.input, output: item.output,
    cacheRead: optionalPrice(item.cacheRead), cacheWrite: optionalPrice(item.cacheWrite),
    kind: item.kind as ModelPricing['kind'], source: item.source, checkedAt: item.checkedAt }
}

export function modelPriceTier(value: unknown): number | null {
  const pricing = parseModelPricing(value)
  if (!pricing) return null
  const cost = pricing.input * 0.75 + pricing.output * 0.25
  if (cost === 0) return 0
  return cost < 0.5 ? 1 : cost < 2 ? 2 : cost < 5 ? 3 : cost < 15 ? 4 : 5
}

export function modelPriceDescription(value: unknown): string {
  const pricing = parseModelPricing(value)
  if (!pricing) return '价格未知：尚无可准确匹配的价格数据，请刷新模型目录。'
  if (pricing.kind === 'local') return `本地运行：零平台调用费，不含硬件和电费。\n来源：${pricing.source}\n核对日期：${pricing.checkedAt.slice(0, 10)}`
  const cost = pricing.input * 0.75 + pricing.output * 0.25
  return [
    pricing.kind === 'api-reference' ? 'API 参考价，不代表订阅实际费用。' : '目录参考价，不代表实际账单。',
    `输入：$${pricing.input}／百万 Token；输出：$${pricing.output}／百万 Token。`,
    `价格等级 $${modelPriceTier(pricing)}：按输入、输出 3:1 计算，参考成本 $${Number(cost.toFixed(6))}／百万混合 Token。`,
    '不计缓存折扣、图片、工具等额外收费；推理档位不改变此评级。',
    pricing.kind === 'api-reference' ? '采用标准模式、短上下文、未缓存单价。' : pricing.kind === 'cloud' ? '采用常规时段、未缓存单价。' : '采用最近一次目录刷新时的基础单价；条件价格及路由可能不同。',
    `来源：${pricing.source}`, `核对日期：${pricing.checkedAt.slice(0, 10)}`,
  ].join('\n')
}

export function openrouterPricing(value: unknown, checkedAt: string): ModelPricing | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const price = (value: unknown): number => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) * 1_000_000 : NaN
  return parseModelPricing({ input: price(item.prompt), output: price(item.completion),
    cacheRead: price(item.input_cache_read), cacheWrite: price(item.input_cache_write),
    kind: 'catalog', source: 'https://openrouter.ai/api/v1/models', checkedAt })
}

/** 目录单价优先，缺失时按 OpenRouter 官方缓存规则补齐基础写入价格。
 * 来源：https://openrouter.ai/docs/guides/best-practices/prompt-caching
 * 核对日期：2026-10-15。免费目录及明确不额外收费的规则不依赖缓存读取字段。
 */
export function openrouterCacheWritePrice(model: string, value: unknown): number | undefined {
  const pricing = parseModelPricing(value)
  if (!pricing) return undefined
  if (pricing.cacheWrite != null) return pricing.cacheWrite
  const id = model.replace(/^~/, '').replace(/:(?:batch|free)$/, '')
  if (pricing.input === 0 && pricing.output === 0) return 0
  if (/^(?:x-ai\/grok-|moonshotai\/kimi-|z-ai\/glm-)/.test(id)) return 0
  if (id.startsWith('openai/')) {
    const name = id.slice('openai/'.length)
    // GPT-5.6 以前不额外收取写入费用；动态别名、开源权重不套用此规则。
    if (/^gpt-(?:3\.5|4(?:o|\.1|-turbo)?|5(?:\.[0-5])?)(?:$|-)/.test(name) || /^o[134](?:$|-)/.test(name)) return 0
    if (name === 'gpt-rosalind-research') return 0
    if (Object.hasOwn(openaiCachePrices, name) && openaiCachePrices[name][1] != null) return pricing.input * 1.25
    if (/^gpt-5\.6-(?:terra|luna|sol)(?:$|-)/.test(name)) return pricing.input * 1.25
  }
  if (pricing.cacheRead == null) return undefined
  if (/^deepseek\/deepseek-/.test(id)) return pricing.input
  // Claude 使用默认的 5 分钟缓存写入价格。
  if (/^anthropic\/claude-/.test(id)) return pricing.input * 1.25
  if (['qwen/qwen3-max', 'qwen/qwen-plus', 'qwen/qwen3.6-plus', 'qwen/qwen3-coder-plus', 'qwen/qwen3-coder-flash'].includes(id)) return pricing.input * 1.25
  // 自动缓存不额外收取写入费用；明确的显式缓存单价已在函数入口优先采用。
  // https://ai.google.dev/gemini-api/docs/caching
  if (/^google\/gemini-(?:2\.5|3(?:\.[1-8])?)-(?:pro|flash)(?:$|-)/.test(id)) return 0
  // https://platform.minimax.io/docs/api-reference/text-prompt-caching
  if (/^minimax\/minimax-(?:m3|m2\.(?:1|5|7))(?:$|-)/.test(id)) return 0
  // 文档的完整计费示例只有普通输入、缓存命中输入及输出，无独立写入费用。
  // https://docs.mistral.ai/studio/conversations/advanced/prompt-caching
  if (id.startsWith('mistralai/')) return 0
  // 模型目录缺失、但同输入/输出/缓存读取口径的端点提供了明确写入单价。
  // https://openrouter.ai/api/v1/models/{模型ID}/endpoints（2026-10-15 核对）
  const endpointReferences: Record<string, readonly [number, number, number, number]> = {
    'qwen/qwen3.8-max-0902': [2, 6, 0.25, 2.5],
    'qwen/qwen3.8-2.4t-a95b': [2, 6, 0.25, 2.5],
    'qwen/qwen3.8-flash': [0.15, 0.47, 0.016, 0.2],
  }
  const reference = Object.hasOwn(endpointReferences, id) ? endpointReferences[id] : undefined
  const same = (a: number, b: number): boolean => Math.abs(a - b) <= Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), 1)
  if (reference && !/:/.test(model) && same(pricing.input, reference[0]) && same(pricing.output, reference[1]) && same(pricing.cacheRead, reference[2])) return reference[3]
  return undefined
}

// 官方标准模式、短上下文价格；只精确匹配已核对型号，禁止使用相近型号代替。
const checkedAt = '2026-10-14'
const openaiPrices: Record<string, readonly [number, number, string?]> = {
  'gpt-6-astra': [10, 50], 'gpt-6.1-sol': [2, 10], 'gpt-6-luna': [0.1, 0.5],
  'gpt-5.6-sol': [4, 20], 'gpt-rosalind-research': [5, 25], 'gpt-rosalind-discovery': [5, 25],
  'gpt-6-sol': [2, 10, 'https://developers.openai.com/api/docs/models/gpt-6-sol'],
  'gpt-5.6-terra': [2, 12, 'https://developers.openai.com/api/docs/models/gpt-5.6-terra'],
  'gpt-5.6-luna': [0.2, 1.2, 'https://developers.openai.com/api/docs/models/gpt-5.6-luna'],
  'gpt-5.3-codex': [1.75, 14],
}
export function chatgptReferencePricing(model: string): ModelPricing | undefined {
  const price = Object.hasOwn(openaiPrices, model) ? openaiPrices[model] : undefined
  const cache = Object.hasOwn(openaiCachePrices, model) ? openaiCachePrices[model] : undefined
  return price ? { input: price[0], output: price[1], cacheRead: cache?.[0], cacheWrite: cache?.[1], kind: 'api-reference', source: price[2] ?? 'https://developers.openai.com/api/docs/pricing', checkedAt: '2026-10-15' } : undefined
}

// 与上面的标准模式、短上下文口径一致；缺失项不推算为免费。
const openaiCachePrices: Record<string, readonly [number, number?]> = {
  'gpt-6-astra': [1, 12.5], 'gpt-6.1-sol': [0.1, 2.5], 'gpt-6-luna': [0.01, 0.125],
  'gpt-5.6-sol': [0.4, 5], 'gpt-rosalind-research': [0.5], 'gpt-rosalind-discovery': [0.5],
  'gpt-6-sol': [0.2, 2.5], 'gpt-5.6-terra': [0.2, 2.5], 'gpt-5.6-luna': [0.02, 0.25],
  'gpt-5.3-codex': [0.175],
}

// Ollama 官方常规时段价格；保留明确的远程型号及 :cloud 名称映射。
const ollamaPrices: Record<string, readonly [number, number]> = {
  'deepseek-v4.1-flash': [0.3, 1.2], 'deepseek-v4-pro': [1.32, 3.96], 'gemma4': [0.14, 0.4],
  'glm-5.3': [1.4, 4.4], 'glm-5.3-flash': [0.15, 0.5], 'glm-5.2': [1.4, 4.4],
  'gpt-oss:120b': [0.15, 0.6], 'gpt-oss:20b': [0.07, 0.3], 'kimi-k3': [3, 15],
  'kimi-k2.7-code': [0.95, 4], 'kimi-k2.6': [0.95, 4], 'minimax-m3': [0.6, 2.4],
  'minimax-m2.7': [0.3, 1.2], 'mistral-large-4': [0.68, 2.09], 'mistral-large-3': [0.5, 1.5],
  'nemotron-3-nano': [0.06, 0.24], 'nemotron-3-super': [0.015, 0.6], 'nemotron-3-ultra': [0.1, 3],
}
export function ollamaModelPricing(model: string, data: Record<string, unknown>): ModelPricing | undefined {
  const remoteHost = typeof data.remote_host === 'string' ? data.remote_host : ''
  const cloud = Boolean(remoteHost || data.remote_model || /(?:[:\-]cloud)$/.test(model))
  if (cloud) {
    // 自定义云端服务的费用不能套用 Ollama 官方价格。
    if (remoteHost) {
      try { if (new URL(remoteHost).hostname !== 'ollama.com') return undefined } catch { return undefined }
    }
    const id = typeof data.remote_model === 'string' ? data.remote_model : model.replace(/(?:[:\-]cloud)$/, '')
    const price = Object.hasOwn(ollamaPrices, id) ? ollamaPrices[id] : undefined
    return price ? { input: price[0], output: price[1], kind: 'cloud', source: 'https://ollama.com/pricing', checkedAt } : undefined
  }
  const info = data.model_info as Record<string, unknown> | undefined
  if (!(typeof data.size === 'number' && data.size > 0) && typeof info?.['general.architecture'] !== 'string') return undefined
  return { input: 0, output: 0, kind: 'local', source: 'Ollama 本地模型元数据', checkedAt: new Date().toISOString() }
}
