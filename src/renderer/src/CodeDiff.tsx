import { useEffect, useMemo, useRef, useState } from 'react'
import { DiffFile, disableCache } from '@git-diff-view/core'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { Button } from '@/components/ui/button'
import { loadPreparedDiff } from './lib/diff-worker-client'
import type { DiffSource, DiffStats, PreparedDiff } from './lib/diff-processing'

disableCache()

export interface CodeDiffProps extends DiffSource {
  mode: 'unified' | 'split'
  theme: 'light' | 'dark'
  onStats?(stats: DiffStats): void
}

/** 使用库默认的行底色、增删符号、词级高亮和上下文展开控件。 */
export default function CodeDiff({ path, before, after, hunks, mode, theme, onStats }: CodeDiffProps): React.JSX.Element {
  const [result, setResult] = useState<PreparedDiff>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const statsCallback = useRef(onStats)
  statsCallback.current = onStats
  useEffect(() => {
    let active = true
    setResult(undefined)
    setError('')
    void loadPreparedDiff({ path, before, after, hunks }, theme).then(value => {
      if (!active) return
      setResult(value)
      statsCallback.current?.(value.stats)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '文件对比加载失败') })
    return () => { active = false }
  }, [path, before, after, hunks, theme, retry])
  const file = useMemo(() => result ? DiffFile.createInstance({}, result.bundle) : undefined, [result])
  useEffect(() => () => { file?._destroy() }, [file])
  if (error) return <div className="tool-approval-preview-state" role="alert">{error}<Button variant="outline" onClick={() => setRetry(value => value + 1)}>重试</Button></div>
  if (!file) return <div className="tool-approval-preview-state" role="status">正在准备文件对比…</div>
  if (result?.stats.added === 0 && result.stats.removed === 0) return <div className="tool-approval-preview-state">文件内容没有变化</div>
  return <DiffView diffFile={file} diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified} diffViewTheme={theme} diffViewHighlight diffViewFontSize={12} diffViewAddWidget={false} />
}
