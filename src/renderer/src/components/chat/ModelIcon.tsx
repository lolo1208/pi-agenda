import { Cpu } from 'lucide-react'
import type { ProviderId } from '../../../../shared/models'
import openai from '../../assets/model-icons/openai.svg'
import claude from '../../assets/model-icons/claude.svg'
import deepseek from '../../assets/model-icons/deepseek.svg'
import qwen from '../../assets/model-icons/qwen.svg'
import meta from '../../assets/model-icons/meta.svg'
import gemini from '../../assets/model-icons/gemini.svg'
import mistral from '../../assets/model-icons/mistral.svg'
import grok from '../../assets/model-icons/grok.svg'
import zhipu from '../../assets/model-icons/zhipu.svg'
import minimax from '../../assets/model-icons/minimax.svg'
import moonshot from '../../assets/model-icons/moonshot.svg'
import ollama from '../../assets/model-icons/ollama.svg'

const brands = [
  { pattern: /claude|anthropic/i, label: 'Claude', icon: claude },
  { pattern: /deepseek/i, label: 'DeepSeek', icon: deepseek },
  { pattern: /qwen|qwq/i, label: 'Qwen', icon: qwen },
  { pattern: /llama|meta-llama/i, label: 'Meta', icon: meta },
  { pattern: /gemini|gemma/i, label: 'Google Gemini', icon: gemini },
  { pattern: /mistral|mixtral|codestral|ministral|devstral|magistral/i, label: 'Mistral', icon: mistral },
  { pattern: /grok/i, label: 'Grok', icon: grok },
  { pattern: /glm|zhipu/i, label: '智谱', icon: zhipu },
  { pattern: /minimax/i, label: 'MiniMax', icon: minimax },
  { pattern: /kimi|moonshot/i, label: 'Kimi', icon: moonshot },
  { pattern: /gpt|chatgpt|codex|(?:^|[/])o[134](?:[-:/]|$)/i, label: 'OpenAI', icon: openai },
]
const providers: Partial<Record<ProviderId, { label: string; icon: string }>> = {
  openai: { label: 'OpenAI', icon: openai }, chatgpt: { label: 'OpenAI', icon: openai },
  anthropic: { label: 'Claude', icon: claude }, deepseek: { label: 'DeepSeek', icon: deepseek },
  ollama: { label: 'Ollama', icon: ollama },
}

export function ModelIcon({ model, provider, size = 15 }: { model?: string; provider?: ProviderId; size?: number }): React.JSX.Element {
  const brand = brands.find(brand => brand.pattern.test(model ?? '')) ?? (provider ? providers[provider] : undefined)
  if (!brand) return <Cpu size={size} aria-label="通用模型图标" />
  return <span className="chat-model-icon" role="img" aria-label={`${brand.label} 图标`} style={{ width: size, height: size, maskImage: `url("${brand.icon}")`, WebkitMaskImage: `url("${brand.icon}")` }} />
}
