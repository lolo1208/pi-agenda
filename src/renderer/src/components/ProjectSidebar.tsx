import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlusCircle, Search, Settings, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Task } from '../app-types'
import { TaskProjectGroup } from './TaskProjectGroup'

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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return <aside className="task-sidebar">
    <nav className="task-actions" aria-label="对话操作">
      <Button disabled={isBusy} title="新建对话" aria-label="新建对话" onClick={onStartTask}><PlusCircle size={17} /><span>新建对话</span></Button>
      <Button title="搜索对话" aria-label="搜索对话" onClick={onToggleSearch} aria-expanded={searchOpen}><Search size={17} /><span>搜索对话</span></Button>
    </nav>
    {searchOpen && <div className="search-field">
      <Search size={15} />
      <Input autoFocus aria-label="搜索对话" placeholder="搜索对话…" value={query} onChange={event => onQueryChange(event.target.value)} />
      <Button className="icon-button" aria-label="关闭搜索" onClick={onCloseSearch}><X size={14} /></Button>
    </div>}
    <div className="task-list">
      {[...groups.entries()].map(([root, tasks]) => <TaskProjectGroup
        key={root}
        root={root}
        tasks={tasks}
        currentTaskId={currentTaskId}
        busyTaskIds={busyTaskIds}
        waitingTaskIds={waitingTaskIds}
        projectBusy={busyProjectRoots.has(root)}
        now={now}
        creationDisabled={isBusy}
        collapsed={collapsedProjects.includes(root)}
        canRemoveProjects={root !== '未关联项目'}
        projectName={projectNames.get(root) ?? root}
        removalDisabled={isBusy || isChatBusy}
        isRemovalPending={pendingProjectRemoval === root}
        onToggleCollapsed={() => onToggleProject(root)}
        onRemovalPendingChange={open => onPendingProjectRemovalChange(open ? root : null)}
        onEditProject={() => onEditProject(root)}
        onRemoveProject={() => onRemoveProject(root)}
        onSelectTask={onSelectTask}
        onEditTask={onEditTask}
        onRemoveTask={onRemoveTask}
        onCreateTask={() => onCreateProjectTask(root)}
      />)}
      {!hasMatchingTasks && query && <p className="hint">没有找到匹配的对话</p>}
    </div>
    <div className="sidebar-bottom"><Button disabled={isChatBusy} onClick={onOpenSettings}><Settings size={16} />设置<small>v0.1</small></Button></div>
  </aside>
}
