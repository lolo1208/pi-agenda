import DiffWorker from './diff.worker?worker'
import type { DiffSource, PreparedDiff } from './diff-processing'

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, { resolve(value: PreparedDiff): void; reject(error: Error): void }>()
const requests = new Map<string, Promise<PreparedDiff>>()
const cache = new Map<string, { value: PreparedDiff; size: number }>()
const MAX_CACHE_BYTES = 24 * 1024 * 1024
let cacheBytes = 0

function getWorker(): Worker {
  if (worker) return worker
  worker = new DiffWorker()
  worker.onmessage = (event: MessageEvent<{ id: number; result?: PreparedDiff; error?: string }>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    if (event.data.result) request.resolve(event.data.result)
    else request.reject(new Error(event.data.error ?? '文件差异计算失败'))
  }
  worker.onerror = () => {
    worker?.terminate()
    worker = undefined
    for (const request of pending.values()) request.reject(new Error('文件对比处理失败，请重试'))
    pending.clear()
  }
  return worker
}

/** 合并重复计算；模式切换和重复展开复用已准备的数据，缓存有内存上限。 */
export function loadPreparedDiff(source: DiffSource, theme: 'light' | 'dark'): Promise<PreparedDiff> {
  const key = JSON.stringify([theme, source.path, source.before, source.after, source.hunks])
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return Promise.resolve(structuredClone(cached.value))
  }
  let request = requests.get(key)
  if (!request) {
    request = new Promise<PreparedDiff>((resolve, reject) => {
      const id = ++nextId
      try {
        const target = getWorker()
        pending.set(id, { resolve, reject })
        target.postMessage({ id, source, theme })
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : new Error('无法启动文件对比处理'))
      }
    }).then(value => {
      const size = key.length * 2 + value.estimatedBytes
      if (size <= MAX_CACHE_BYTES) {
        while (cache.size >= 16 || cacheBytes + size > MAX_CACHE_BYTES) {
          const oldest = cache.keys().next().value!
          cacheBytes -= cache.get(oldest)!.size
          cache.delete(oldest)
        }
        cache.set(key, { value, size })
        cacheBytes += size
      }
      return value
    }).finally(() => { requests.delete(key) })
    requests.set(key, request)
  }
  // 展开上下文会修改行状态，各个视图必须使用独立副本。
  return request.then(value => structuredClone(value))
}
