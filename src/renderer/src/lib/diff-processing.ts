import { DiffFile, disableCache, getLang } from '@git-diff-view/core'
import { generateDiffFile } from '@git-diff-view/file'

export interface DiffSource { path: string; before: string; after: string; hunks?: string[] }
export interface DiffStats { added: number; removed: number }
export interface PreparedDiff {
  bundle: ReturnType<DiffFile['_getFullBundle']>
  stats: DiffStats
  estimatedBytes: number
}

// 结果缓存由调用方统一限制大小，避免库内部再保留完整文件和高亮结果。
disableCache()

/** 在 Worker 内一次完成差异、高亮和两种视图准备，统计复用相同的差异结果。 */
export function prepareDiff(source: DiffSource, theme: 'light' | 'dark'): PreparedDiff {
  const language = getLang(source.path)
  const file = source.hunks
    ? new DiffFile(source.path, source.before, source.path, source.after, source.hunks, language, language)
    : generateDiffFile(source.path, source.before, source.path, source.after, language, language, { context: 3 })
  try {
    file.initTheme(theme)
    file.init()
    file.buildSplitDiffLines()
    file.buildUnifiedDiffLines()
    const bundle = file._getFullBundle()
    // 缓存尺寸也在 Worker 中估算，避免界面线程遍历整份高亮结果。
    return { bundle, stats: { added: file.additionLength, removed: file.deletionLength }, estimatedBytes: JSON.stringify(bundle).length * 2 }
  } finally {
    file.clear()
  }
}
