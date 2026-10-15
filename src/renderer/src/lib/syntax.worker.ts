import { highlightSyntax } from './syntax-processing'
import type { SyntaxSource } from './syntax-types'

self.onmessage = (event: MessageEvent<{ id: number; source: SyntaxSource }>) => {
  const { id, source } = event.data
  try { self.postMessage({ id, result: highlightSyntax(source) }) }
  catch { self.postMessage({ id, error: '代码着色失败' }) }
}
