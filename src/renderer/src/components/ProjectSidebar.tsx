import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MessageCirclePlus, Search, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Modal } from '@/components/ui/modal'
import { UNLINKED_PROJECT_LABEL } from '../app-types'
import type { Task } from '../app-types'
import { TaskProjectHeading, TaskProjectRow } from './TaskProjectGroup'

interface ProjectSidebarProps {
  groups: Map<string, Task[]>
  busyProjectRoots: Set<string>
  projectNames: Map<string, string>
  hasMatchingTasks: boolean
  currentTaskId?: string
  busyTaskIds: string[]
  waitingTaskIds: string[]
  query: string
  searchOpen: boolean
  collapsedProjects: string[]
  pendingProjectRemoval: string | null
  isBusy: boolean
  isChatBusy: boolean
  onStartTask: () => void
  onToggleSearch: () => void
  onQueryChange: (query: string) => void
  onCloseSearch: () => void
  onToggleProject: (root: string) => void
  onPendingProjectRemovalChange: (root: string | null) => void
  onEditProject: (root: string) => void
  onRemoveProject: (root: string) => void
  onSelectTask: (task: Task) => void
  onEditTask: (task: Task) => void
  onRemoveTask: (task: Task) => void
  onCreateProjectTask: (root: string) => void
  onOpenSettings: () => void
}

export function ProjectSidebar({ groups, busyProjectRoots, projectNames, hasMatchingTasks, currentTaskId, busyTaskIds, waitingTaskIds, query, searchOpen, collapsedProjects, pendingProjectRemoval, isBusy, isChatBusy, onStartTask, onToggleSearch, onQueryChange, onCloseSearch, onToggleProject, onPendingProjectRemovalChange, onEditProject, onRemoveProject, onSelectTask, onEditTask, onRemoveTask, onCreateProjectTask, onOpenSettings }: ProjectSidebarProps): React.JSX.Element {
  const [now, setNow] = useState(Date.now)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const rows = useMemo(() => {
    const collapsed = new Set(collapsedProjects)
    const result: { key: string; root: string; tasks: Task[]; task?: Task; empty?: boolean }[] = []
    for (const [root, tasks] of groups) {
      result.push({ key: `project:${root}`, root, tasks })
      if (collapsed.has(root)) continue
      for (const task of tasks) result.push({ key: `task:${task.id}`, root, tasks, task })
      if (!tasks.length && root !== UNLINKED_PROJECT_LABEL) result.push({ key: `empty:${root}`, root, tasks, empty: true })
    }
    return result
  }, [groups, collapsedProjects])
  const deletionDisabled = isBusy || Boolean(deletingTask && busyTaskIds.includes(deletingTask.id))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return <aside className="task-sidebar">
    <nav className="task-actions" aria-label="对话操作">
      <Button className="conversation-action-button" disabled={isBusy} title="新建对话" aria-label="新建对话" onClick={onStartTask}><MessageCirclePlus size={17} aria-hidden="true" /><span>新建对话</span></Button>
      <Button title="搜索对话" aria-label="搜索对话" onClick={onToggleSearch} aria-expanded={searchOpen}><Search size={17} /><span>搜索对话</span></Button>
    </nav>
    {searchOpen && <div className="search-field">
      <Search size={15} />
      <Input autoFocus aria-label="搜索对话" placeholder="搜索对话…" value={query} onChange={event => onQueryChange(event.target.value)} />
      <Button className="icon-button" aria-label="关闭搜索" onClick={onCloseSearch}><X size={14} /></Button>
    </div>}
    <Virtuoso className="task-list" aria-label="项目与对话" tabIndex={0} data={rows} defaultItemHeight={36} increaseViewportBy={200}
      computeItemKey={(_, row) => row.key}
      initialTopMostItemIndex={Math.max(0, rows.findIndex(row => row.task?.id === currentTaskId))}
      itemContent={(index, row) => row.task ? <TaskProjectRow task={row.task} currentTaskId={currentTaskId} busyTaskIds={busyTaskIds} waitingTaskIds={waitingTaskIds} now={now} creationDisabled={isBusy} onSelectTask={onSelectTask} onEditTask={onEditTask} onRemoveTask={onRemoveTask} onRequestTaskRemoval={setDeletingTask} />
        : row.empty ? <Button className="project-start conversation-action-button" disabled={isBusy} onClick={() => onCreateProjectTask(row.root)}><MessageCirclePlus size={14} aria-hidden="true" />新建对话</Button>
        : <div style={{ paddingTop: index ? 10 : 0 }}><TaskProjectHeading
          root={row.root} tasks={row.tasks} currentTaskId={currentTaskId} busyTaskIds={busyTaskIds} waitingTaskIds={waitingTaskIds}
          projectBusy={busyProjectRoots.has(row.root)} now={now} creationDisabled={isBusy} collapsed={collapsedProjects.includes(row.root)}
          canRemoveProjects={row.root !== UNLINKED_PROJECT_LABEL} projectName={projectNames.get(row.root) ?? row.root}
          removalDisabled={isBusy || isChatBusy} isRemovalPending={false} hideRemovalDialog
          onToggleCollapsed={() => onToggleProject(row.root)} onRemovalPendingChange={open => onPendingProjectRemovalChange(open ? row.root : null)}
          onEditProject={() => onEditProject(row.root)} onRemoveProject={() => onRemoveProject(row.root)}
          onSelectTask={onSelectTask} onEditTask={onEditTask} onRemoveTask={onRemoveTask} onCreateTask={() => onCreateProjectTask(row.root)}
        /></div>}
    />
    {!hasMatchingTasks && query && <p className="hint">没有找到匹配的对话</p>}
    <Modal open={Boolean(deletingTask)} onOpenChange={open => { if (!open) setDeletingTask(null) }} title="删除此对话？" description={`将删除“${deletingTask?.title ?? ''}”的全部消息和草稿，删除后无法恢复。项目文件会保留。`} closeDisabled={deletionDisabled}>
      <div className="modal-actions"><Button variant="outline" autoFocus onClick={() => setDeletingTask(null)}>取消</Button><Button variant="destructive" disabled={deletionDisabled} onClick={() => { if (deletingTask) { onRemoveTask(deletingTask); setDeletingTask(null) } }}>确认删除</Button></div>
    </Modal>
    <Modal open={Boolean(pendingProjectRemoval)} onOpenChange={open => { if (!open) onPendingProjectRemovalChange(null) }} title="移除此项目？" description="同时移除此项目的对话，并删除 Pi Agenda 快照数据。项目文件会保留。" closeDisabled={isBusy || isChatBusy}>
      <div className="modal-actions"><Button variant="outline" autoFocus disabled={isBusy || isChatBusy} onClick={() => onPendingProjectRemovalChange(null)}>取消</Button><Button variant="destructive" disabled={isBusy || isChatBusy} onClick={() => { if (pendingProjectRemoval) onRemoveProject(pendingProjectRemoval) }}>确认移除</Button></div>
    </Modal>
    <div className="sidebar-bottom"><Button onClick={onOpenSettings}><Settings size={16} />设置<small>v0.1</small></Button></div>
  </aside>
}
