import { MAX_MESSAGE_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_CONVERSATION_ATTACHMENT_BYTES, PROVIDER_PRESETS, type ChatImage, type ChatMessage, type ModelProfile, type SaveModelProfile } from '../../shared/models'
import { ATTACHMENT_DATA_URL } from '../../shared/attachments'

export class ModelError extends Error {}
export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModelError('请求格式不正确')
  return value as Record<string, unknown>
}
export function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ModelError(`${label}不能为空且不能超过 ${max} 个字符`)
  return value.trim()
}
export function profileId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) throw new ModelError('配置标识无效')
  return value
}
export function normalizeBaseUrl(value: unknown): string {
  let url: URL
  try { url = new URL(requiredString(value, 'Base URL', 2048)) } catch { throw new ModelError('请输入有效的 Base URL') }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) throw new ModelError('远程服务必须使用 HTTPS；HTTP 仅支持本机 localhost、127.0.0.1 或 ::1')
  if (url.username || url.password || url.search || url.hash) throw new ModelError('Base URL 不能包含用户名、密码、查询参数或片段')
  if (/\/(chat\/completions|messages|responses)\/?$/.test(url.pathname)) throw new ModelError('请填写 API 根地址（通常以 /v1 结尾），不要包含具体请求路径')
  return url.href.replace(/\/+$/, '')
}
function numberInRange(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new ModelError(`${label}须在 ${min}–${max} 范围内${integer ? '且为整数' : ''}`)
  return value
}
export function normalizeOllamaUrl(value: unknown): string {
  const url = new URL(normalizeBaseUrl(value))
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new ModelError('Ollama 目前仅支持本机服务地址')
  return url.href.replace(/\/+$/, '').replace(/\/v1$/, '')
}
export function parseProfile(value: unknown): ModelProfile {
  const item = asRecord(value)
  if (!PROVIDER_PRESETS.some(preset => preset.id === item.provider)) throw new ModelError('未知服务商')
  if (item.protocol !== 'anthropic' && item.protocol !== 'openai-compatible') throw new ModelError('不支持的模型协议')
  if (item.tokenParameter !== 'max_tokens' && item.tokenParameter !== 'max_completion_tokens') throw new ModelError('无效的 Token 参数')
  if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new ModelError('模型启用状态无效')
  if (item.thinking !== undefined && item.thinking !== null && typeof item.thinking !== 'boolean') throw new ModelError('推理模式无效')
  const contextTokens = item.contextTokens === undefined || item.contextTokens === null ? null : numberInRange(item.contextTokens, 1, 2097152, '上下文上限', true)
  if (item.provider === 'chatgpt' && (item.baseUrl !== 'https://chatgpt.com/backend-api' || item.protocol !== 'openai-compatible' || item.temperature !== null)) throw new ModelError('ChatGPT 订阅使用固定服务地址，Temperature 由服务决定')
  if (contextTokens !== null && typeof item.maxTokens === 'number' && item.maxTokens > contextTokens) throw new ModelError('输出 Token 上限不能超过上下文上限')
  return {
    id: profileId(item.id), name: requiredString(item.name, '配置名称', 80),
    provider: item.provider as ModelProfile['provider'], protocol: item.protocol,
    baseUrl: item.provider === 'ollama' ? normalizeOllamaUrl(item.baseUrl) : normalizeBaseUrl(item.baseUrl), model: requiredString(item.model, '模型 ID', 200),
    contextTokens, enabled: item.enabled === undefined ? true : item.enabled,
    thinking: item.thinking ?? null,
    temperature: item.temperature === null ? null : numberInRange(item.temperature, 0, item.protocol === 'anthropic' ? 1 : 2, 'Temperature'),
    maxTokens: numberInRange(item.maxTokens, 1, 131072, '输出 Token 上限', true),
    tokenParameter: item.tokenParameter,
    timeoutSeconds: numberInRange(item.timeoutSeconds, 5, 300, '超时秒数', true)
  }
}
export function parseSaveProfile(value: unknown): SaveModelProfile {
  const item = asRecord(value)
  const credential = asRecord(item.credential)
  if (!['keep', 'replace', 'remove'].includes(String(credential.action))) throw new ModelError('无效凭证操作')
  const action = credential.action as SaveModelProfile['credential']['action']
  const apiKey = action === 'replace' ? requiredString(credential.value, 'API Key', 8192) : undefined
  if (apiKey && /[^\x21-\x7e]/.test(apiKey)) throw new ModelError('API Key 不能包含空白或非 ASCII 字符')
  return { profile: parseProfile(item.profile), credential: { action, value: apiKey } }
}
export function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new ModelError('对话须包含 1–100 条消息，请清空对话后重试')
  let length = 0
  let imageBytes = 0
  const messages = value.map(message => {
    const item = asRecord(message)
    if (item.role !== 'user' && item.role !== 'assistant') throw new ModelError('无效消息角色')
    let images: ChatImage[] | undefined
    if (item.images !== undefined) {
      if (item.role !== 'user' || !Array.isArray(item.images) || item.images.length > MAX_MESSAGE_ATTACHMENTS) throw new ModelError(`每条用户消息最多包含 ${MAX_MESSAGE_ATTACHMENTS} 个附件`)
      images = item.images.map(value => {
        const image = asRecord(value)
        const id = profileId(image.id)
        const name = requiredString(image.name, '附件名称', 255)
        if (typeof image.dataUrl !== 'string' || image.dataUrl.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 256) throw new ModelError('每个附件不能超过 32 MiB')
        const match = ATTACHMENT_DATA_URL.exec(image.dataUrl)
        if (!match || match[2].length % 4 !== 0) throw new ModelError('附件编码无效，请重新选择文件')
        const bytes = Buffer.from(match[2], 'base64')
        const mime = match[1].toLowerCase()
        const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
          : mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          : mime === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          : mime === 'image/gif' ? /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) : true
        if (!valid || bytes.toString('base64') !== match[2]) throw new ModelError('附件内容或编码无效，请重新选择文件')
        if (bytes.length > MAX_ATTACHMENT_BYTES) throw new ModelError('每个附件不能超过 32 MiB')
        imageBytes += bytes.length
        return { id, name, dataUrl: image.dataUrl }
      })
    }
    if (typeof item.content !== 'string' || item.content.length > 32000) throw new ModelError('消息不能超过 32000 个字符')
    const content = item.content.trim()
    if (!content && !images?.length) throw new ModelError('消息不能为空')
    length += content.length
    return { role: item.role, content, ...(images?.length ? { images } : {}) } as ChatMessage
  })
  if (length > 128000) throw new ModelError('对话过长，请清空对话后重试')
  if (imageBytes > MAX_CONVERSATION_ATTACHMENT_BYTES) throw new ModelError('对话附件总量超过 128 MiB，请新建对话后重试')
  if (messages.at(-1)?.role !== 'user') throw new ModelError('最后一条消息必须为用户输入')
  return messages
}
