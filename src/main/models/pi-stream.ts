import type { AssistantMessage, AssistantMessageEventStream } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'

/** 在 pi 记录会话之前过滤密钥回显，并限制单次模型响应大小。 */
export function safePiStream(source: AssistantMessageEventStream, apiKey: string, abortSource: () => void = () => {}): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream()
  const sanitize = (message: AssistantMessage): AssistantMessage => {
    const copy = structuredClone(message)
    if (copy.errorMessage) copy.errorMessage = copy.stopReason === 'aborted' ? '模型请求已取消' : '模型服务请求失败，请检查接口、密钥和模型配置'
    if (apiKey) for (const block of copy.content) {
      if (block.type === 'text') block.text = block.text.split(apiKey).join('[已隐藏密钥]')
      if (block.type === 'thinking') block.thinking = block.thinking.split(apiKey).join('[已隐藏密钥]')
    }
    return copy
  }
  void (async () => {
    let bytes = 0, last: AssistantMessage | undefined
    const pending = new Map<number, string>()
    try {
      for await (const event of source) {
        if ('partial' in event) last = sanitize(event.partial)
        if (event.type === 'text_delta' || event.type === 'thinking_delta' || event.type === 'toolcall_delta') {
          bytes += Buffer.byteLength(event.delta)
          if (bytes > 2 * 1024 * 1024) throw new Error('模型响应超过 2 MiB 上限，请降低输出 Token 上限')
        }
        if (apiKey && event.type === 'text_delta') {
          const text = ((pending.get(event.contentIndex) ?? '') + event.delta).split(apiKey).join('[已隐藏密钥]')
          let retained = 0
          for (let length = 1; length < apiKey.length; length++) if (text.endsWith(apiKey.slice(0, length))) retained = length
          pending.set(event.contentIndex, retained ? text.slice(-retained) : '')
          const delta = retained ? text.slice(0, -retained) : text
          if (delta) output.push({ ...event, delta, partial: last! })
        } else if (event.type === 'text_end') {
          const tail = pending.get(event.contentIndex)
          if (tail) output.push({ type: 'text_delta', contentIndex: event.contentIndex, delta: tail, partial: last! })
          pending.delete(event.contentIndex)
          output.push({ ...event, content: apiKey ? event.content.split(apiKey).join('[已隐藏密钥]') : event.content, partial: last! })
        } else if (event.type === 'done') output.push({ ...event, message: sanitize(event.message) })
        else if (event.type === 'error') output.push({ ...event, error: sanitize(event.error) })
        else if ('partial' in event) output.push({ ...event, partial: last! })
      }
    } catch {
      abortSource()
      last ??= { role: 'assistant', api: 'openai-completions', provider: 'pi-agenda', model: '', content: [], timestamp: Date.now(), stopReason: 'error', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
      last.stopReason = 'error'
      last.errorMessage = bytes > 2 * 1024 * 1024 ? '模型响应超过 2 MiB 上限，请降低输出 Token 上限' : '模型响应读取失败，请重试'
      if (bytes > 2 * 1024 * 1024) last.content = []
      output.push({ type: 'error', reason: 'error', error: last })
    } finally { output.end(last) }
  })()
  return output
}
