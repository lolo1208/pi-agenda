import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, FolderClosed, FolderOpen, MessageCircle, PlusCircle, Trash2 } from 'lucide-react'
import { UNLINKED_PROJECT_LABEL, type Task } from '../app-types'

interface TaskProjectGroupProps {
  root: string
  tasks: Task[]
  currentTaskId?: string
  busyTaskIds: string[]
  collapsed: boolean
  canRemoveProjects: boolean
  removalDisabled: boolean
  isRemovalPending: boolean
  onToggleCollapsed: () => void
  onRemovalPendingChange: (open: boolean) => void
  onRemoveProject: () => void
  onSelectTask: (task: Task) => void
  onCreateTask: () => void
}

function getProjectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root
}

export function TaskProjectGroup({ root, tasks, currentTaskId, busyTaskIds, collapsed, canRemoveProjects, removalDisabled, isRemovalPending, onToggleCollapsed, onRemovalPendingChange, onRemoveProject, onSelectTask, onCreateTask }: TaskProjectGroupProps): React.JSX.Element {
  return <section className="project-group" key={root}>
    <div className="project-heading-row">
      <Button className="project-heading" title={root} aria-expanded={!collapsed} onClick={onToggleCollapsed}>
        {collapsed ? <ChevronRight className="project-chevron" size={14} /> : <ChevronDown className="project-chevron" size={14} />}
        {collapsed ? <FolderClosed size={15} /> : <FolderOpen size={15} />}
        <span>{root === UNLINKED_PROJECT_LABEL ? root : getProjectName(root)}</span>
      </Button>
      {canRemoveProjects && <AlertDialog open={isRemovalPending} onOpenChange={onRemovalPendingChange}>
        <AlertDialogTrigger asChild>
          <Button className="project-remove-button" aria-label={`移除项目 ${getProjectName(root)}`} title="移除项目并删除快照数据" disabled={removalDisabled} onClick={event => event.stopPropagation()}>
            <Trash2 size={14} />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除此项目？</AlertDialogTitle>
            <AlertDialogDescription>同时移除此项目的对话，并删除 Pi Console 快照数据。项目文件会保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removalDisabled}>取消</AlertDialogCancel>
            <AlertDialogAction className="destructive" disabled={removalDisabled} onClick={event => { event.preventDefault(); onRemoveProject() }}>确认移除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
    </div>
    {!collapsed && tasks.map(task => <Button className={`task-item project-task-item ${task.id === currentTaskId ? 'selected' : ''}`} aria-current={task.id === currentTaskId ? 'true' : undefined} key={task.id} onClick={() => onSelectTask(task)}>
      <span className="task-title"><MessageCircle size={14} /><b>{task.title}</b>{busyTaskIds.includes(task.id) && <i className="busy-dot" />}</span>
      <span className="task-preview">{task.preview}</span>
    </Button>)}
    {!collapsed && !tasks.length && root !== UNLINKED_PROJECT_LABEL && <Button className="project-start" onClick={onCreateTask}><PlusCircle size={14} />新建对话</Button>}
  </section>
}
