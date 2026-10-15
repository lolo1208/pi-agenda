import type { SyntaxResult, SyntaxSource } from './syntax-types'

let worker: Worker | undefined
let workerLoading: Promise<Worker> | undefined
let nextId = 0
const pending = new Map<number, { resolve(value: SyntaxResult): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
const requests = new Map<string, Promise<SyntaxResult>>()
const cache = new Map<string, { result: SyntaxResult; bytes: number }>()
let cacheBytes = 0
const MAX_CACHE_BYTES = 16 * 1024 * 1024

function failWorker(): void {
  worker?.terminate()
  worker = undefined
  workerLoading = undefined
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('代码着色暂不可用')) }
  pending.clear()
}

async function getWorker(): Promise<Worker> {
  if (worker) return worker
  workerLoading ??= import('./syntax.worker?worker').then(({ default: SyntaxWorker }) => {
    worker = new SyntaxWorker()
    worker.onmessage = (event: MessageEvent<{ id: number; result?: SyntaxResult; error?: string }>) => {
      const request = pending.get(event.data.id)
      if (!request) return
      pending.delete(event.data.id)
      clearTimeout(request.timer)
      if (event.data.result) request.resolve(event.data.result)
      else request.reject(new Error(event.data.error ?? '代码着色失败'))
    }
    worker.onerror = failWorker
    worker.onmessageerror = failWorker
    return worker
  }).catch(error => { workerLoading = undefined; throw error })
  return workerLoading
}

/** 合并重复计算，主题配色由 CSS 切换，无需重新解析代码。 */
export function loadSyntax(source: SyntaxSource): Promise<SyntaxResult> {
  const key = JSON.stringify(source)
  const cached = cache.get(key)
  if (cached) { cache.delete(key); cache.set(key, cached); return Promise.resolve(cached.result) }
  const existing = requests.get(key)
  if (existing) return existing
  const request = getWorker().then(target => new Promise<SyntaxResult>((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(failWorker, 15000)
    pending.set(id, { resolve, reject, timer })
    try { target.postMessage({ id, source }) }
    catch { failWorker() }
  })).then(result => {
    const bytes = (key.length + JSON.stringify(result).length) * 2
    if (bytes <= MAX_CACHE_BYTES) {
      while (cache.size >= 64 || cacheBytes + bytes > MAX_CACHE_BYTES) {
        const oldest = cache.keys().next().value!
        cacheBytes -= cache.get(oldest)!.bytes
        cache.delete(oldest)
      }
      cache.set(key, { result, bytes })
      cacheBytes += bytes
    }
    return result
  }).finally(() => { requests.delete(key) })
  requests.set(key, request)
  return request
}
