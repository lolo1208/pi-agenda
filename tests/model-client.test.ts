import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { ModelClient } from '../src/main/models/model-client'
import { ModelService, modelResult } from '../src/main/models/model-service'
import type { ModelSettingsStore } from '../src/main/models/model-settings-store'
import type { ModelProfile } from '../src/shared/models'

const profile: ModelProfile = {
  id: 'test', name: 'Test', provider: 'custom', protocol: 'openai-compatible', baseUrl: 'https://example.com/v1',
  model: 'fixture-model', temperature: null, maxTokens: 1024, tokenParameter: 'max_completion_tokens', timeoutSeconds: 5
}
const messages = [{ role: 'user' as const, content: 'hello' }]
const signal = (): AbortSignal => new AbortController().signal
const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const reply = { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] }
const servers: Server[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
})
describe('ModelClient', () => {
  it('sends OpenAI-compatible headers and configured token parameter, omitting unset temperature', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(reply))
    const result = await new ModelClient(fetcher).complete(profile, 'test-key', messages, signal())
    expect(result.text).toBe('Hello')
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://example.com/v1/chat/completions')
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(options?.redirect).toBe('error')
    expect(JSON.parse(String(options?.body))).toEqual({ model: 'fixture-model', messages, stream: false, max_completion_tokens: 1024 })
  })
  it('adapts native Claude Messages and extracts text without exposing thinking blocks', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Claude reply' }], stop_reason: 'max_tokens' }))
    const result = await new ModelClient(fetcher).complete({ ...profile, protocol: 'anthropic', temperature: 0.4 }, 'test-key', messages, signal())
    expect(result).toMatchObject({ text: 'Claude reply', truncated: true })
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://example.com/v1/messages')
    expect(options?.headers).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' })
    expect(JSON.parse(String(options?.body))).toMatchObject({ max_tokens: 1024, temperature: 0.4 })
  })
  it.each([400, 401, 403, 404, 429, 500])('reports HTTP %s without leaking an upstream reflected secret', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-reflected-by-gateway', { status }))
    const result = await modelResult(() => new ModelClient(fetcher).complete(profile, 'secret-reflected-by-gateway', messages, signal()))
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain(`HTTP ${status}`)
    expect(JSON.stringify(result)).not.toContain('secret-reflected-by-gateway')
  })
  it('rejects malformed, empty and oversized responses', async () => {
    for (const response of [new Response('not json'), jsonResponse({ choices: [] }), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
      await expect(new ModelClient(vi.fn<typeof fetch>().mockResolvedValue(response)).complete(profile, '', messages, signal())).rejects.toThrow()
    }
  })
  it('redacts a credential reflected in successful output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'key=top-secret-key' } }] }))
    expect((await new ModelClient(fetcher).complete(profile, 'top-secret-key', messages, signal())).text).not.toContain('top-secret-key')
  })
  it('connects to a real local HTTP service and never follows redirects with credentials', async () => {
    let redirected = false
    const server = createServer((request, response) => {
      if (request.url === '/v1/chat/completions') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(reply)) }
      else if (request.url === '/redirect/chat/completions') { response.writeHead(302, { Location: '/stolen' }); response.end() }
      else { redirected = true; response.end('unexpected') }
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port')
    const origin = `http://127.0.0.1:${address.port}`
    expect((await new ModelClient().complete({ ...profile, baseUrl: `${origin}/v1` }, '', messages, signal())).text).toBe('Hello')
    await expect(new ModelClient().complete({ ...profile, baseUrl: `${origin}/redirect` }, 'secret', messages, signal())).rejects.toThrow('重定向')
    expect(redirected).toBe(false)
  })
})
describe('ModelService lifecycle', () => {
  function setup() {
    const store = { getForRequest: async () => ({ profile, apiKey: '' }) } as unknown as ModelSettingsStore
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    return new ModelService(store, new ModelClient(fetcher))
  }
  it('supports cancellation, rejects concurrent work, and can start again after cancellation', async () => {
    const service = setup()
    const pending = modelResult(() => service.request('test', 'request-1', messages, false))
    await Promise.resolve()
    await expect(service.request('test', 'request-2', messages, false)).rejects.toThrow('已有模型请求')
    await service.cancel('request-1')
    expect(await pending).toEqual({ ok: false, error: '模型请求已取消' })
    const next = modelResult(() => service.request('test', 'request-3', messages, false))
    await Promise.resolve(); await service.cancel('request-3')
    expect((await next).ok).toBe(false)
  })
  it('times out and exposes a readable message', async () => {
    vi.useFakeTimers()
    const service = setup()
    const pending = modelResult(() => service.request('test', 'timeout', null, true))
    await vi.advanceTimersByTimeAsync(5001)
    expect(await pending).toEqual({ ok: false, error: '模型请求超时，请检查服务或增加超时秒数' })
  })
})
