import type { ModelProfile } from '../../shared/models'
import { randomUUID } from 'node:crypto'
import { normalizeOllamaUrl } from './model-validation'

/** 保留 Ollama 原生上下文、推理参数，将 NDJSON 映射到 pi 的流式协议。 */
export function ollamaFetch(profile: ModelProfile, fetchRequest: typeof fetch): typeof fetch {
  return async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    const messages = request.messages.map((message: Record<string, any>) => {
      const blocks = Array.isArray(message.content) ? message.content : []
      const images = blocks.filter(block => block.type === 'image_url').map(block => block.image_url.url.split(',')[1])
      return { ...message, content: blocks.length ? blocks.filter(block => block.type === 'text').map(block => block.text).join('\n') : message.content ?? '',
        ...(images.length ? { images } : {}),
        ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call: Record<string, any>) => ({ ...call, function: { ...call.function, arguments: typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments } })) } : {}) }
    })
    const response = await fetchRequest(`${normalizeOllamaUrl(profile.baseUrl)}/api/chat`, {
      ...init, redirect: 'error', body: JSON.stringify({ model: profile.model, messages, stream: true, ...(request.tools?.length ? { tools: request.tools } : {}),
        ...(profile.thinking != null ? { think: profile.thinking } : {}), options: { num_predict: profile.maxTokens,
          ...(profile.contextTokens != null ? { num_ctx: profile.contextTokens } : {}), ...(profile.temperature !== null ? { temperature: profile.temperature } : {}) } })
    })
    if (!response.ok || !response.body) return response
    const encoder = new TextEncoder()
    const responseId = randomUUID()
    let pending = '', toolIndex = 0, finished = false
    const stream = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, Uint8Array>({
      transform(chunk, controller) {
        pending += chunk
        const lines = pending.split('\n'); pending = lines.pop()!
        for (const line of lines) if (line.trim()) emit(JSON.parse(line), controller)
      },
      flush(controller) {
        if (pending.trim()) emit(JSON.parse(pending), controller)
        if (!finished) throw new Error('Ollama 响应意外中断，请重试')
      }
    }))
    function emit(item: Record<string, any>, controller: TransformStreamDefaultController<Uint8Array>): void {
      if (item.error) throw new Error('Ollama 服务返回错误，请检查模型和请求参数')
      const delta: Record<string, unknown> = { role: 'assistant' }
      if (item.message?.content) delta.content = item.message.content
      if (item.message?.thinking) delta.reasoning_content = item.message.thinking
      if (item.message?.tool_calls?.length) delta.tool_calls = item.message.tool_calls.map((call: Record<string, any>) => {
        const index = toolIndex++
        return { index, id: `${responseId}-${index}`, type: 'function', function: { name: call.function.name, arguments: JSON.stringify(call.function.arguments) } }
      })
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', model: profile.model, choices: [{ index: 0, delta, finish_reason: item.done ? toolIndex ? 'tool_calls' : item.done_reason === 'length' ? 'length' : 'stop' : null }],
        ...(item.done ? { usage: { prompt_tokens: item.prompt_eval_count ?? 0, completion_tokens: item.eval_count ?? 0, total_tokens: (item.prompt_eval_count ?? 0) + (item.eval_count ?? 0) } } : {}) })}\n\n`))
      if (item.done) { finished = true; controller.enqueue(encoder.encode('data: [DONE]\n\n')) }
    }
    return new Response(stream, { status: response.status, headers: { 'content-type': 'text/event-stream' } })
  }
}
