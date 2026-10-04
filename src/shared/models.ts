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
}
export interface ModelProfileView extends ModelProfile { hasApiKey: boolean }
export interface ModelSettings {
  profiles: ModelProfileView[]
  activeProfileId: string | null
  encryptionAvailable: boolean
}
export interface SaveModelProfile {
  profile: ModelProfile
  credential: { action: 'keep' | 'replace' | 'remove'; value?: string }
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ModelReply { text: string; elapsedMs: number; model: string; truncated: boolean }
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
