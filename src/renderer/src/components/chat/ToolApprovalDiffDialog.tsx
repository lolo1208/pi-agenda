import { useEffect, useState } from 'react'
import { FileCode2, LockKeyhole, ShieldQuestion, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { baseName, DiffFileHeader, DiffStat, DiffView, DiffViewSwitch, fileIcon, initialDiffViewMode, type DiffViewMode } from './DiffView'
import type { ToolApproval, ToolApprovalPreview } from '../../../../shared/models'

type EntryState = 'loading' | 'ready' | 'error'

interface FileEntry {
  approval: ToolApproval
  isFile: boolean
  name: string
  path: string
  preview?: ToolApprovalPreview
  state: EntryState
  stats?: { added: number; removed: number }
  message?: string
}

function isFileChange(approval: ToolApproval): boolean {
  return ['edit', 'write'].includes(approval.tool)
}

function filePath(approval: ToolApproval): string {
  return typeof approval.args.path === 'string' ? approval.args.path : approval.cwd
}

function commandOf(approval: ToolApproval): string {
  return typeof approval.args.command === 'string' ? approval.args.command : JSON.stringify(approval.args, null, 2)
}

export function ToolApprovalDiffDialog({ open, onOpenChange, approvals, getPreview }: {
  open: boolean
  onOpenChange(open: boolean): void
  approvals: ToolApproval[]
  getPreview(approval: ToolApproval): Promise<ToolApprovalPreview>
}): React.JSX.Element {
  const [mode, setMode] = useState<DiffViewMode>(initialDiffViewMode)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [loadTick, setLoadTick] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setEntries(approvals.map(approval => ({ approval, isFile: isFileChange(approval), name: baseName(filePath(approval)), path: filePath(approval), state: isFileChange(approval) ? 'loading' : 'ready' })))
    setCollapsed({})
    for (const approval of approvals.filter(isFileChange)) {
      getPreview(approval).then(preview => {
        if (!cancelled) setEntries(prev => prev.map(e => e.approval.id === approval.id ? { ...e, preview, state: 'ready' } : e))
      }).catch(e => {
        if (!cancelled) setEntries(prev => prev.map(item => item.approval.id === approval.id ? { ...item, state: 'error', message: e instanceof Error ? e.message : '修改对比加载失败' } : item))
      })
    }
    return () => { cancelled = true }
  }, [open, approvals, getPreview, loadTick])

  const fileCount = entries.filter(e => e.isFile).length
  const title = fileCount > 0 ? `${fileCount} 个文件` : '执行操作'

  return <Modal open={open} onOpenChange={onOpenChange} title={<span className="tool-approval-file-title"><FileCode2 size={18} aria-hidden="true" /><span>{title}</span></span>}
    description={<span>本次请求批准的操作共 {entries.length} 项，确认后将按权限执行</span>}
    headingExtra={<DiffViewSwitch mode={mode} onChange={setMode} />}
    contentClassName="tool-approval-preview tool-approval-multi">
    <div className="tool-approval-filelist">
      {entries.length === 0 && <div className="tool-approval-preview-state" role="status"><span>没有待审批的文件操作</span></div>}
      {entries.map(entry => {
        const isCollapsed = collapsed[entry.approval.id] ?? false
        const stat = entry.stats
        return <section key={entry.approval.id} className={`tool-approval-file${isCollapsed ? ' is-collapsed' : ''}`}>
          <DiffFileHeader
            icon={entry.isFile ? fileIcon(entry.path) : <Terminal size={15} aria-hidden="true" />}
            name={entry.name}
            path={entry.path}
            expanded={!isCollapsed}
            onToggle={() => setCollapsed(prev => ({ ...prev, [entry.approval.id]: !isCollapsed }))}
            trailing={stat && <DiffStat additions={stat.added} deletions={stat.removed} />}
          />
          {!isCollapsed && <div className="tool-approval-file-body">
            {entry.state === 'loading' && <div className="tool-approval-preview-state" role="status"><span>正在加载修改对比…</span></div>}
            {entry.state === 'error' && <div className="tool-approval-preview-state" role="alert"><ShieldQuestion size={24} aria-hidden="true" /><p>{entry.message}</p><Button type="button" variant="outline" onClick={() => setLoadTick(t => t + 1)}>重试</Button></div>}
            {entry.state === 'ready' && (entry.isFile
              ? <DiffView before={entry.preview!.before} after={entry.preview!.after} mode={mode} path={entry.preview!.path} onStats={stats => setEntries(prev => prev.map(item => item.approval.id === entry.approval.id ? { ...item, stats } : item))} />
              : <pre className="tool-approval-operation">{commandOf(entry.approval)}</pre>)}
          </div>}
        </section>
      })}
    </div>
    <footer className="tool-approval-preview-footer"><span className="tool-approval-readonly"><LockKeyhole size={12} aria-hidden="true" />只读预览</span><span className="tool-approval-reason">{entries[0]?.approval.reason}</span></footer>
  </Modal>
}
