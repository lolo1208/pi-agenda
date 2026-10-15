export interface CodeLineRange { start: number; end: number }
export interface CodeReference { path: string; ranges: CodeLineRange[] }
export interface CodePreview {
  path: string
  totalLines: number
  /** 完整文件用于跨行语法解析，界面仍只展示 sections 指定的上下文。 */
  content: string
  sections: { start: number; lines: string[] }[]
}

/** 排序并合并相邻定位，限制异常模型输出和 IPC 参数。 */
export function normalizeCodeRanges(input: unknown): CodeLineRange[] {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('代码行号无效')
  const sorted = input.map(range => {
    if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 1 || range.end < range.start) throw new Error('代码行号无效')
    return { start: range.start as number, end: range.end as number }
  }).sort((a, b) => a.start - b.start)
  const result: CodeLineRange[] = []
  for (const range of sorted) {
    const last = result.at(-1)
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end)
    else result.push(range)
  }
  return result
}

// 兼容“第10至25行”“第10行至第25行”及多段定位。
const LINE_RANGE_SOURCE = String.raw`\d+(?:\s*(?:行\s*)?[-–—~～至到]\s*(?:第\s*)?\d+)?`
export const CODE_REFERENCE_SOURCE = String.raw`(?:\x60\[?|\[\x60?|)?((?:[A-Za-z]:[\\/]|/|\.{1,2}[\\/])?[\p{L}\p{N}_@.+/\\-]+\.[\p{L}\p{N}_-]+?)(?:\]\x60?|\x60\]?|)?\s*第\s*(${LINE_RANGE_SOURCE}(?:\s*(?:行\s*)?[、,，]\s*(?:第\s*)?${LINE_RANGE_SOURCE})*)\s*行`

export function parseCodeReference(source: string): { raw: string; reference: CodeReference } | undefined {
  const match = new RegExp(`^${CODE_REFERENCE_SOURCE}`, 'u').exec(source)
  if (!match) return
  try {
    const ranges = normalizeCodeRanges(match[2].split(/[、,，]/).map(part => {
      const [start, end = start] = part.replace(/[第行\s]/g, '').split(/[-–—~～至到]/).map(Number)
      return { start, end }
    }))
    return { raw: match[0], reference: { path: match[1], ranges } }
  } catch { return }
}
