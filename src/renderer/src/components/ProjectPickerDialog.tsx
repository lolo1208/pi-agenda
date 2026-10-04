import { Button } from '@/components/ui/button'
import { ChevronRight, FolderOpen, PlusCircle, X } from 'lucide-react'

interface ProjectPickerDialogProps {
  projects: string[]
  error: string
  isBusy: boolean
  onClose: () => void
  onOpenProject: (root: string) => void
  onChooseProjectDirectory: () => void
}

function getProjectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root
}

export function ProjectPickerDialog({ projects, error, isBusy, onClose, onOpenProject, onChooseProjectDirectory }: ProjectPickerDialogProps): React.JSX.Element {
  return <div className="project-picker-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !isBusy) onClose() }}>
    <section className="project-picker" role="dialog" aria-modal="true" aria-labelledby="project-picker-title">
      <div className="project-picker-heading">
        <div><h2 id="project-picker-title">新建对话</h2><p>选择此对话要使用的项目。</p></div>
        <Button className="icon-button" aria-label="关闭" disabled={isBusy} onClick={onClose}><X size={17} /></Button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="project-picker-list">
        {projects.map(root => <Button key={root} disabled={isBusy} onClick={() => onOpenProject(root)}>
          <FolderOpen size={17} /><span><b>{getProjectName(root)}</b><small>{root}</small></span><ChevronRight size={16} />
        </Button>)}
        {!projects.length && <p className="hint">还没有已添加的项目。</p>}
      </div>
      <Button className="project-new-button" disabled={isBusy} onClick={onChooseProjectDirectory}><PlusCircle size={17} />选择新的项目目录</Button>
      {isBusy && <p className="hint" role="status">正在打开项目…</p>}
    </section>
  </div>
}
