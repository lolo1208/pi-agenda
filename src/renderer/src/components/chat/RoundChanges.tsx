import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgentSnapshot } from '../../../../shared/models'
import { RoundDiffDialog } from './RoundDiffDialog'
import { FileContextMenu } from './FileContextMenu'
import { baseName, fileIcon } from './DiffView'
import { PROJECT_FILES_RESTORED, type RoundFileState } from '../../hooks/useRoundFileState'
import type { RoundChangesData } from '../../hooks/useRoundChanges'

export function RoundChanges({ round, disabled, data, onRetry, fileState = data?.fileState ?? 'checking' }: { round: AgentSnapshot; disabled?: boolean; data?: RoundChangesData; onRetry?: () => void; fileState?: RoundFileState }): React.JSX.Element | null {
  const files = data?.files
  const [expanded, setExpanded] = useState(false)
  const [review, setReview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [restored, setRestored] = useState(false)
  const lock = useRef(false)
  const listId = useId()
  useEffect(() => { setRestored(false) }, [fileState, disabled])
  const toggle = async (): Promise<void> => {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await window.piAgenda.restoreCheckpoint(round.after.hash, round.project)
      setRestored(true)
      setNotice('项目文件已还原到此轮结果')
      window.dispatchEvent(new CustomEvent(PROJECT_FILES_RESTORED, { detail: round.project }))
    } catch (e) { setError(e instanceof Error ? e.message : '文件恢复失败，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  if (files?.length === 0) return null
  const additions = files?.reduce((sum, file) => sum + file.additions, 0) ?? 0
  const deletions = files?.reduce((sum, file) => sum + file.deletions, 0) ?? 0
  const hidden = files ? files.length - 3 : 0
  return <section className="round-changes" aria-label="本轮文件改动" aria-busy={busy || data?.status === 'loading'}>
    <header className="round-changes-header">
      <div className="round-changes-summary">
        <button type="button" className="round-changes-title" disabled={!files} title={files ? `审查本轮 ${files.length} 个文件的改动` : undefined} onClick={() => setReview('')}>{files ? <span className="round-changes-title-text">已更改 {files.length} 个文件</span> : data?.status === 'loading' ? '正在读取文件改动…' : data?.status === 'error' ? '文件改动读取失败' : '等待加载文件改动…'}{files && <ChevronRight className="round-changes-title-hint" size={14} aria-hidden="true" />}</button>
        {files && <span className="tool-approval-diffstat"><em>+{additions}</em>{deletions > 0 && <em className="is-del">-{deletions}</em>}</span>}
      </div>
      {files && <div className="round-changes-actions">{fileState === 'matches' || restored
        ? <span className="round-changes-current" role="status" title="项目文件与此轮结束时的状态一致"><Check size={14} aria-hidden="true" />文件已同步</span>
        : fileState === 'different'
          ? <Button variant="ghost" aria-label="还原到此轮结果" disabled={disabled || busy || !files} onClick={() => void toggle()} title="把整个项目还原到此轮结束时的文件状态，包括后来新增和删除的文件"><RotateCcw size={14} aria-hidden="true" />{busy ? '正在还原…' : '还原至此'}</Button>
          : fileState === 'error'
            ? <Button variant="ghost" aria-label="重新检查文件状态" onClick={() => window.dispatchEvent(new CustomEvent(PROJECT_FILES_RESTORED, { detail: round.project }))}>状态检查失败，重试</Button>
            : <span className="round-changes-current" role="status">正在检查文件状态…</span>}
      </div>}
    </header>
    {files && <div id={listId} className="round-changes-list">{(expanded ? files : files.slice(0, 3)).map(file => <FileContextMenu key={file.path} project={round.project} path={file.path}><button type="button" className="round-changes-file" onClick={() => setReview(file.path)} title={file.path}>{fileIcon(file.path)}<span className="tool-approval-file-meta"><strong title={baseName(file.path)}>{baseName(file.path)}</strong><small title={file.path}>{file.path}</small></span><span className="tool-approval-diffstat">{file.binary ? '二进制' : <><em>+{file.additions}</em>{file.deletions > 0 && <em className="is-del">-{file.deletions}</em>}</>}</span></button></FileContextMenu>)}</div>}
    {files && files.length > 3 && <Button className="round-changes-more" variant="ghost" aria-controls={listId} aria-expanded={expanded} aria-label={expanded ? '收起' : `更多（${hidden} 个文件）`} onClick={() => setExpanded(value => !value)}>{expanded ? <>收起 <ChevronUp size={14} aria-hidden="true" /></> : <>再显示 {hidden} 个文件 <ChevronDown size={14} aria-hidden="true" /></>}</Button>}
    {(error || data?.error) && <div className="round-changes-error" role="alert">{error || data?.error}{!files && onRetry && <Button variant="ghost" onClick={onRetry}>重试</Button>}</div>}
    {notice && <div className="round-changes-notice" role="status">{notice}</div>}
    {review !== null && files && <RoundDiffDialog round={round} files={files} selectedPath={review} onClose={() => setReview(null)} />}
  </section>
}
