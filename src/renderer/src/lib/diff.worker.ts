import { prepareDiff, type DiffSource } from './diff-processing'

self.onmessage = (event: MessageEvent<{ id: number; source: DiffSource; theme: 'light' | 'dark' }>) => {
  const { id, source, theme } = event.data
  try {
    self.postMessage({ id, result: prepareDiff(source, theme) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '文件差异计算失败' })
  }
}
