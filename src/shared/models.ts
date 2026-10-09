export type ModelProtocol = 'openai-compatible' | 'anthropic'
export type ProviderId = 'openai' | 'anthropic' | 'deepseek' | 'ollama' | 'vllm' | 'custom'
export interface ModelProfile {
  id: string
  name: string
  provider: ProviderId
  protocol: ModelProtocol
  baseUrl: string
  model: string
  temperature: number | null
  maxTokens: number
  tokenParameter: 'max_tokens' | 'max_completion_tokens'
  timeoutSeconds: number
  /** 模型独立的上下文上限；留空时使用服务默认值。 */
  contextTokens?: number | null
  enabled?: boolean
  thinking?: boolean | null
}
export interface ModelDescriptor {
  id: string
  sizeBytes?: number
  parameterSize?: string
  quantization?: string
  capabilities: string[]
  maxContextTokens: number | null
}
export interface ModelProviderConnection { provider: ProviderId; baseUrl: string; models: ModelDescriptor[] }
export interface ModelProfileView extends ModelProfile { hasApiKey: boolean; available?: boolean }
export interface ModelSettings {
  profiles: ModelProfileView[]
  activeProfileId: string | null
  encryptionAvailable: boolean
  providers?: ModelProviderConnection[]
}
export interface SaveModelProfile {
  profile: ModelProfile
  credential: { action: 'keep' | 'replace' | 'remove'; value?: string }
}
export const MAX_MESSAGE_IMAGES = 8
export const MAX_CUSTOM_PROMPT_LENGTH = 32000
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_CONVERSATION_IMAGE_BYTES = 32 * 1024 * 1024
export interface ChatImage { id: string; name: string; dataUrl: string }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; images?: ChatImage[] }
export interface ModelUsage { inputTokens: number; outputTokens: number }
export interface ModelRateLimit { kind: 'requests' | 'tokens'; limit: number; remaining: number; reset?: string }
export interface ModelReply { text: string; elapsedMs: number; model: string; truncated: boolean; usage?: ModelUsage; rateLimits?: ModelRateLimit[] }
export type ModelResult<T> = { ok: true; value: T } | { ok: false; error: string }
export interface ProviderPreset { id: ProviderId; label: string; protocol: ModelProtocol; baseUrl: string }
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'ollama', label: 'Ollama', protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' },
  { id: 'vllm', label: 'vLLM', protocol: 'openai-compatible', baseUrl: 'http://localhost:8000/v1' },
  { id: 'custom', label: '自定义服务', protocol: 'openai-compatible', baseUrl: '' }
]
