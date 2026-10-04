import { PROVIDER_PRESETS, type ChatMessage, type ModelProfile, type SaveModelProfile } from '../../shared/models'

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
export function parseProfile(value: unknown): ModelProfile {
  const item = asRecord(value)
  if (!PROVIDER_PRESETS.some(preset => preset.id === item.provider)) throw new ModelError('未知服务商')
  if (item.protocol !== 'anthropic' && item.protocol !== 'openai-compatible') throw new ModelError('不支持的模型协议')
  if (item.tokenParameter !== 'max_tokens' && item.tokenParameter !== 'max_completion_tokens') throw new ModelError('无效的 Token 参数')
  return {
    id: profileId(item.id), name: requiredString(item.name, '配置名称', 80),
    provider: item.provider as ModelProfile['provider'], protocol: item.protocol,
    baseUrl: normalizeBaseUrl(item.baseUrl), model: requiredString(item.model, '模型 ID', 200),
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
  const messages = value.map(message => {
    const item = asRecord(message)
    if (item.role !== 'user' && item.role !== 'assistant') throw new ModelError('无效消息角色')
    const content = requiredString(item.content, '消息', 32000)
    length += content.length
    return { role: item.role, content } as ChatMessage
  })
  if (length > 128000) throw new ModelError('对话过长，请清空对话后重试')
  if (messages.at(-1)?.role !== 'user') throw new ModelError('最后一条消息必须为用户输入')
  return messages
}
