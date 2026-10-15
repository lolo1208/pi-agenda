import { Button } from '@/components/ui/button'
import { Camera, ChevronRight, Files, Globe, Terminal, X } from 'lucide-react'
import { DiffView } from './chat/DiffView'
import type { ChangedFile, Checkpoint, FileDiff } from '../../../shared/api'
import { useState } from 'react'
import { PagedList } from './PagedList'

type ToolId = 'snapshots' | 'files' | 'terminal' | 'browser'

interface ToolSidebarProps {
  project: string | null
  isBusy: boolean
  activeTool: ToolId
  checkpoints: Checkpoint[]
  changes: ChangedFile[]
  diff: FileDiff | null
  theme: 'light' | 'dark'
  inlineDiff: boolean
  onToolChange: (tool: ToolId) => void
  onClose: () => void
  onCaptureCheckpoint: () => void
  onRollbackCheckpoint: () => void
  onSelectDiff: (filePath: string) => void
}

const tools: { id: ToolId; label: string; icon: typeof Camera }[] = [
  { id: 'snapshots', label: '快照', icon: Camera },
  { id: 'files', label: '文件', icon: Files },
  { id: 'terminal', label: '终端', icon: Terminal },
  { id: 'browser', label: '浏览器', icon: Globe },
]

function PlaceholderTool({ tool }: { tool: Exclude<ToolId, 'snapshots'> }): React.JSX.Element {
  const placeholders = {
    files: { label: '文件浏览器', icon: Files },
    terminal: { label: '终端', icon: Terminal },
    browser: { label: '浏览器', icon: Globe },
  }
  const { label, icon: Icon } = placeholders[tool]

  return <div className="tool-placeholder">
    <Icon size={30} />
    <h3>{label}</h3>
    <span className="badge">待实现</span>
    <p>已纳入后续开发计划，完成后将在这里使用。</p>
  </div>
}

export function ToolSidebar({ project, isBusy, activeTool, checkpoints, changes, diff, theme, inlineDiff, onToolChange, onClose, onCaptureCheckpoint, onRollbackCheckpoint, onSelectDiff }: ToolSidebarProps): React.JSX.Element {
  const [historyOpen, setHistoryOpen] = useState(false)
  return <section className="tool-sidebar" aria-label="侧栏工具">
    <header>
      <span>侧栏工具</span>
      <Button className="icon-button" aria-label="关闭工具栏" onClick={onClose}><X size={17} /></Button>
    </header>
    <nav className="tool-tabs" aria-label="工具选择">
      {tools.map(({ id, label, icon: Icon }) => <Button key={id} aria-pressed={activeTool === id} onClick={() => onToolChange(id)}><Icon size={16} />{label}</Button>)}
    </nav>
    {activeTool === 'snapshots' ? <div className="snapshot-panel">
      <div className="snapshot-summary">
        <h3>项目快照</h3>
        <p className="hint">{project ?? '打开项目后，创建基准快照。'}</p>
        <Button disabled={!project || isBusy} onClick={onCaptureCheckpoint}><Camera size={16} />{isBusy ? '处理中…' : checkpoints.length ? '捕获当前改动' : '创建基准快照'}</Button>
        <Button disabled={!project || isBusy || !changes.length || checkpoints.length < 2} onClick={onRollbackCheckpoint}>回滚最近改动</Button>
        <p className="hint">修改前后自动保存快照。回滚会先保存当前状态；有后续手动修改时会停止回滚。</p>
        <details onToggle={event => setHistoryOpen(event.currentTarget.open)}>
          <summary>快照记录 · {checkpoints.length}</summary>
          {historyOpen && <PagedList items={checkpoints} label="快照记录" resetKey={project ?? ''}>{page => page.map(checkpoint => <div className="checkpoint" key={checkpoint.hash}><span>{checkpoint.label}</span><code>{checkpoint.hash.slice(0, 8)}</code></div>)}</PagedList>}
        </details>
        <h3>最近改动 <span className="muted">{changes.length}</span></h3>
        <PagedList items={changes} label="最近改动" resetKey={project ?? ''}>{page => page.map(file => <Button className="file" disabled={isBusy} key={file.path} onClick={() => onSelectDiff(file.path)}>
          <b>{file.status}</b><span>{file.path}</span><ChevronRight size={14} />
        </Button>)}</PagedList>
        {!changes.length && <p className="hint">暂无文件差异</p>}
      </div>
      {diff && <div className="diff">
        <header title={diff.path}>{diff.path}</header>
        {diff.binary ? <p className="empty">二进制文件不支持文本对比</p> : <DiffView path={diff.path} before={diff.before} after={diff.after} hunks={diff.hunks} mode={inlineDiff ? 'unified' : 'split'} theme={theme} />}
      </div>}
    </div> : <PlaceholderTool tool={activeTool} />}
  </section>
}
