/** 只缓存不可变提交的读取结果；正在进行的相同请求共享一次读取。 */
export class SnapshotReadCache<T> {
  private readonly values = new Map<string, { value: T; bytes: number }>()
  private readonly pending = new Map<string, Promise<T>>()
  private bytes = 0

  constructor(private readonly maxEntries: number, private readonly maxBytes: number, private readonly sizeOf: (value: T) => number) {}

  get(key: string, read: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key)
    if (cached) {
      this.values.delete(key)
      this.values.set(key, cached)
      return Promise.resolve(cached.value)
    }
    const existing = this.pending.get(key)
    if (existing) return existing
    const request = Promise.resolve().then(read).then(value => {
      if (this.pending.get(key) !== request) return value
      const bytes = this.sizeOf(value) + key.length * 2
      if (bytes <= this.maxBytes) {
        while (this.values.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
          const oldest = this.values.keys().next().value!
          this.bytes -= this.values.get(oldest)!.bytes
          this.values.delete(oldest)
        }
        this.values.set(key, { value, bytes })
        this.bytes += bytes
      }
      return value
    }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key) })
    this.pending.set(key, request)
    return request
  }

  clearPrefix(prefix: string): void {
    for (const [key, entry] of this.values) {
      if (!key.startsWith(prefix)) continue
      this.bytes -= entry.bytes
      this.values.delete(key)
    }
    for (const key of this.pending.keys()) if (key.startsWith(prefix)) this.pending.delete(key)
  }
}
