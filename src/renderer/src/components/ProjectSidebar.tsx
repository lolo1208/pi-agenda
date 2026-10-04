import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlusCircle, Search, Settings, X } from 'lucide-react'
import type { Task } from '../app-types'
import { TaskProjectGroup } from './TaskProjectGroup'

interface ProjectSidebarProps {
  groups: Map<string, Task[]>
  hasMatchingTasks: boolean
  currentTaskId?: string
  busyTaskIds: string[]
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
  onRemoveProject: (root: string) => void
  onSelectTask: (task: Task) => void
  onCreateProjectTask: (root: string) => void
  onOpenSettings: () => void
}

export function ProjectSidebar({ groups, hasMatchingTasks, currentTaskId, busyTaskIds, query, searchOpen, collapsedProjects, pendingProjectRemoval, isBusy, isChatBusy, onStartTask, onToggleSearch, onQueryChange, onCloseSearch, onToggleProject, onPendingProjectRemovalChange, onRemoveProject, onSelectTask, onCreateProjectTask, onOpenSettings }: ProjectSidebarProps): React.JSX.Element {
  return <aside className="task-sidebar">
    <div className="sidebar-brand"><span>π <b>Pi Console</b></span></div>
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
        collapsed={collapsedProjects.includes(root)}
        canRemoveProjects={root !== '未关联项目'}
        removalDisabled={isBusy || isChatBusy}
        isRemovalPending={pendingProjectRemoval === root}
        onToggleCollapsed={() => onToggleProject(root)}
        onRemovalPendingChange={open => onPendingProjectRemovalChange(open ? root : null)}
        onRemoveProject={() => onRemoveProject(root)}
        onSelectTask={onSelectTask}
        onCreateTask={() => onCreateProjectTask(root)}
      />)}
      {!hasMatchingTasks && <p className="hint">{query ? '没有找到匹配的对话' : '新建对话并选择一个项目。'}</p>}
    </div>
    <div className="sidebar-bottom"><Button disabled={isChatBusy} onClick={onOpenSettings}><Settings size={16} />设置<small>v0.1</small></Button></div>
  </aside>
}
