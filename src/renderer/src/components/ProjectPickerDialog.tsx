import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ChevronRight, FolderOpen, PlusCircle } from 'lucide-react'

interface ProjectPickerDialogProps {
  projects: string[]
  projectNames: Map<string, string>
  error: string
  isBusy: boolean
  onClose: () => void
  onOpenProject: (root: string) => void
  onChooseProjectDirectory: () => void
}

function getProjectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root
}

export function ProjectPickerDialog({ projects, projectNames, error, isBusy, onClose, onOpenProject, onChooseProjectDirectory }: ProjectPickerDialogProps): React.JSX.Element {
  return <Modal open onOpenChange={open => { if (!open && !isBusy) onClose() }} title="新建对话" description="选择此对话要使用的项目。" closeLabel="关闭" closeDisabled={isBusy}>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="project-picker-list">
      {projects.map(root => <Button key={root} disabled={isBusy} title={root} onClick={() => onOpenProject(root)}>
        <FolderOpen size={17} /><span><b>{projectNames.get(root) ?? getProjectName(root)}</b><small>{root}</small></span><ChevronRight size={16} />
      </Button>)}
      {!projects.length && <p className="hint">还没有已添加的项目。</p>}
    </div>
    <Button className="project-new-button" disabled={isBusy} onClick={onChooseProjectDirectory}><PlusCircle size={17} />选择新的项目目录</Button>
    {isBusy && <p className="hint" role="status">正在打开项目…</p>}
  </Modal>
}
