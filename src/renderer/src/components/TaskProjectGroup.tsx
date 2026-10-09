import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ChevronRight, FolderClosed, FolderOpen, LoaderCircle, MessageCircle, Plus, PlusCircle, Trash2 } from 'lucide-react'
import { UNLINKED_PROJECT_LABEL, type Task } from '../app-types'
import { formatTaskTime } from '../task-time'

interface TaskProjectGroupProps {
  root: string
  tasks: Task[]
  currentTaskId?: string
  busyTaskIds: string[]
  now?: number
  creationDisabled?: boolean
  collapsed: boolean
  canRemoveProjects: boolean
  removalDisabled: boolean
  isRemovalPending: boolean
  onToggleCollapsed: () => void
  onRemovalPendingChange: (open: boolean) => void
  onRemoveProject: () => void
  onSelectTask: (task: Task) => void
  onRemoveTask: (task: Task) => void
  onCreateTask: () => void
}

function getProjectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root
}

export function TaskProjectGroup({ root, tasks, currentTaskId, busyTaskIds, now = Date.now(), creationDisabled = false, collapsed, canRemoveProjects, removalDisabled, isRemovalPending, onToggleCollapsed, onRemovalPendingChange, onRemoveProject, onSelectTask, onRemoveTask, onCreateTask }: TaskProjectGroupProps): React.JSX.Element {
  return <section className="project-group" key={root}>
    <div className="project-heading-row">
      <Button className="project-heading" title={root} aria-expanded={!collapsed} onClick={onToggleCollapsed}>
        <span className="project-folder" aria-hidden="true">{collapsed ? <FolderClosed size={15} /> : <FolderOpen size={15} />}<ChevronRight className={`project-chevron ${collapsed ? '' : 'expanded'}`} size={14} /></span>
        <span>{root === UNLINKED_PROJECT_LABEL ? root : getProjectName(root)}</span>
      </Button>
      {root !== UNLINKED_PROJECT_LABEL && <Button className="project-create-button" aria-label={`在项目 ${getProjectName(root)} 中新建对话`} title="新建对话" disabled={creationDisabled} onClick={onCreateTask}><Plus size={14} /></Button>}
      {canRemoveProjects && <AlertDialog open={isRemovalPending} onOpenChange={onRemovalPendingChange}>
        <AlertDialogTrigger asChild>
          <Button className="project-remove-button" aria-label={`移除项目 ${getProjectName(root)}`} title="移除项目并删除快照数据" disabled={removalDisabled} onClick={event => event.stopPropagation()}>
            <Trash2 size={14} />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除此项目？</AlertDialogTitle>
            <AlertDialogDescription>同时移除此项目的对话，并删除 Pi Agenda 快照数据。项目文件会保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removalDisabled}>取消</AlertDialogCancel>
            <AlertDialogAction className="destructive" disabled={removalDisabled} onClick={event => { event.preventDefault(); onRemoveProject() }}>确认移除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
    </div>
    {!collapsed && tasks.map(task => {
      const busy = busyTaskIds.includes(task.id)
      const time = formatTaskTime(task.updatedAt, now)
      return <div className={`task-row ${task.id === currentTaskId ? 'selected' : ''} ${busy ? 'running' : ''}`} key={task.id}>
      <Button className={`task-item project-task-item ${task.id === currentTaskId ? 'selected' : ''} ${busy ? 'running' : ''}`} aria-current={task.id === currentTaskId ? 'true' : undefined} title={`${task.title}${task.preview ? `\n${task.preview}` : ''}`} onClick={() => onSelectTask(task)}>
        <span className="task-title"><MessageCircle className="task-icon" size={13} aria-hidden="true" /><b>{task.title}</b></span>
        {busy ? <span className="task-running-status" role="status" aria-label="正在回复"><LoaderCircle className="task-spinner" size={14} aria-hidden="true" /></span> : time && <time className="task-time" dateTime={new Date(task.updatedAt!).toISOString()} title={new Date(task.updatedAt!).toLocaleString('zh-CN')}>{time}</time>}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button className="task-delete-button" aria-label={`删除对话 ${task.title}`} title={busy ? '回复结束后可删除对话' : '删除对话'} disabled={busy || creationDisabled}><Trash2 size={14} aria-hidden="true" /></Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此对话？</AlertDialogTitle>
            <AlertDialogDescription>将删除“{task.title}”的全部消息和草稿，删除后无法恢复。项目文件会保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="destructive" disabled={busy || creationDisabled} onClick={() => onRemoveTask(task)}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    })}
    {!collapsed && !tasks.length && root !== UNLINKED_PROJECT_LABEL && <Button className="project-start" disabled={creationDisabled} onClick={onCreateTask}><PlusCircle size={14} />新建对话</Button>}
  </section>
}
