import type { ChatMessage, ModelUsage } from './models'
import { attachmentKind, attachmentText } from './attachments'

export const DEFAULT_COMPRESSION_THRESHOLD = 90
export function normalizeCompressionThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(60, Math.min(95, Math.round(value))) : DEFAULT_COMPRESSION_THRESHOLD
}
export interface ContextCompaction { summary: string; coveredMessages: number }
export interface ContextOptions { threshold: number; usage?: ModelUsage }
export function estimateTextTokens(text: string): number {
  const wide = Array.from(text).filter(character => /[^\x00-\x7F]/.test(character)).length
  return Math.ceil(wide + (text.length - wide) / 4)
}
export function estimateContextTokens(messages: ChatMessage[], instruction = ''): number {
  return estimateTextTokens(instruction) + messages.reduce((total, message) => total + estimateTextTokens(message.content) + 4 + (message.images ?? []).reduce((sum, file) => sum + (attachmentKind(file) === 'text' ? estimateTextTokens(`附件：${file.name}\n${attachmentText(file)}`) : 1024), 0), 0)
}
export function contextMessages(messages: ChatMessage[], compaction?: ContextCompaction): ChatMessage[] {
  return compaction ? [{ role: 'user', content: compaction.summary }, ...messages.slice(compaction.coveredMessages)] : messages
}
