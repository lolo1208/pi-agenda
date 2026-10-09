import { useEffect, useState } from 'react'
import type { ChangedFile, Checkpoint, FileDiff } from '../../../shared/api'
import type { Task } from '../app-types'

interface ProjectSnapshotState {
  checkpoints: Checkpoint[]
  changes: ChangedFile[]
  diff: FileDiff | null
}

const emptySnapshotState: ProjectSnapshotState = { checkpoints: [], changes: [], diff: null }

function readProjectList(): string[] {
  try {
    const current = localStorage.getItem('pi-agenda.projects')
    const legacy = localStorage.getItem('pi-agenda.workspaces')
    const roots: unknown = JSON.parse(current ?? legacy ?? '[]')
    const projects = Array.isArray(roots) ? roots.filter((root): root is string => typeof root === 'string' && root.length > 0) : []
    if (current === null && legacy !== null) {
      localStorage.setItem('pi-agenda.projects', JSON.stringify(projects))
      localStorage.removeItem('pi-agenda.workspaces')
    }
    return projects
  } catch {
    return []
  }
}

function createTask(project: string): Task {
  return { id: crypto.randomUUID(), title: '新建对话', preview: '开始一段新的对话', project, updatedAt: Date.now() }
}

export function useProjectWorkspace() {
  const [project, setProject] = useState<string | null>(null)
  const [savedProjects, setSavedProjects] = useState(readProjectList)
  const [snapshotsByProject, setSnapshotsByProject] = useState<Record<string, ProjectSnapshotState>>({})
  const [isBusy, setIsBusy] = useState(true)
  const [error, setError] = useState('')
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [pendingProjectRemoval, setPendingProjectRemoval] = useState<string | null>(null)
  const [busyTasks, setBusyTasks] = useState<string[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void window.piAgenda.loadConversations().then(state => {
      if (!active) return
      setTasks(state.tasks)
      setSelectedId(state.selectedId)
      setLoaded(true)
      const root = (state.tasks.find(task => task.id === state.selectedId) ?? state.tasks[0])?.project
      if (root) {
        void window.piAgenda.openProject(root).then(opened => { if (active) setProject(opened) })
          .catch(error => { if (active) setError(`会话已恢复，但项目打开失败：${error instanceof Error ? error.message : String(error)}`) })
          .finally(() => { if (active) setIsBusy(false) })
      } else setIsBusy(false)
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : '无法读取本地会话，请重启应用后重试。')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!loaded) return
    void window.piAgenda.saveConversations({ version: 1, tasks, selectedId }).catch(() => {
      setError('会话未能保存到本地，请检查磁盘空间和访问权限。')
    })
  }, [loaded, tasks, selectedId])

  const currentTask = tasks.find(item => item.id === selectedId) ?? tasks[0]
  const snapshotKey = currentTask?.project ?? project ?? 'unlinked'
  const projectSnapshot = snapshotsByProject[snapshotKey] ?? emptySnapshotState
  const isChatBusy = busyTasks.length > 0

  const updateProjectSnapshot = (update: Partial<ProjectSnapshotState>): void => {
    setSnapshotsByProject(current => ({ ...current, [snapshotKey]: { ...(current[snapshotKey] ?? emptySnapshotState), ...update } }))
  }

  const rememberProject = (root: string): void => {
    setSavedProjects(current => {
      const next = [root, ...current.filter(item => item !== root)]
      try {
        localStorage.setItem('pi-agenda.projects', JSON.stringify(next))
      } catch {
        setError('项目列表未能保存到本地。')
      }
      return next
    })
  }

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  const addTask = (root: string): void => {
    const task = createTask(root)
    setTasks(items => [task, ...items])
    setSelectedId(task.id)
    setQuery('')
    setError('')
  }

  const createProjectTask = (): void => {
    if (!loaded || isBusy) return
    void runAction(async () => {
      const root = await window.piAgenda.selectProject()
      if (!root) return
      rememberProject(root)
      setProject(root)
      setProjectPickerOpen(false)
      addTask(root)
    })
  }

  const chooseExistingProject = (root: string): void => {
    if (!loaded || isBusy) return
    void runAction(async () => {
      const opened = root === project ? root : await window.piAgenda.openProject(root)
      setProject(opened)
      rememberProject(opened)
      setProjectPickerOpen(false)
      addTask(opened)
    })
  }

  const selectTask = (task: Task): void => {
    if (!task.project || task.project === project) {
      setSelectedId(task.id)
      return
    }

    void runAction(async () => {
      const opened = await window.piAgenda.openProject(task.project!)
      setProject(opened)
      rememberProject(opened)
      setSelectedId(task.id)
    })
  }

  const removeTask = (task: Task): void => {
    if (isBusy || busyTasks.includes(task.id)) return
    const isCurrent = currentTask?.id === task.id
    const remaining = tasks.filter(item => item.id !== task.id)
    const fallback = remaining.find(item => item.project === task.project) ?? remaining[0]
    const finishRemoval = (): void => {
      setTasks(items => items.filter(item => item.id !== task.id))
      if (isCurrent) {
        setSelectedId(fallback?.id ?? null)
        setQuery('')
        if (fallback?.project) setCollapsedProjects(items => items.filter(root => root !== fallback.project))
      }
    }
    if (isCurrent && fallback?.project && fallback.project !== project) {
      void runAction(async () => {
        const opened = await window.piAgenda.openProject(fallback.project!)
        setProject(opened)
        finishRemoval()
      })
    } else {
      finishRemoval()
    }
  }

  const removeProject = (root: string): void => {
    void runAction(async () => {
      await window.piAgenda.removeProject(root)
      const remainingProjects = readProjectList().filter(item => item !== root)
      setSavedProjects(remainingProjects)
      try {
        localStorage.setItem('pi-agenda.projects', JSON.stringify(remainingProjects))
      } catch {
        setError('项目列表未能保存到本地。')
      }

      const remainingTasks = tasks.filter(item => item.project !== root)
      setTasks(current => current.filter(item => item.project !== root))
      setSnapshotsByProject(current => {
        const next = { ...current }
        delete next[root]
        return next
      })

      if (currentTask?.project === root) {
        const fallback = remainingTasks[0]
        if (fallback?.project) {
          const opened = await window.piAgenda.openProject(fallback.project)
          setProject(opened)
          setSelectedId(fallback.id)
        } else {
          setProject(null)
          setSelectedId(null)
        }
      } else if (project === root) {
        setProject(null)
      }
      setPendingProjectRemoval(null)
    })
  }

  const captureCheckpoint = (): void => {
    void runAction(async () => {
      const next = await window.piAgenda.createCheckpoint(`手动快照 ${projectSnapshot.checkpoints.length + 1}`)
      const previous = projectSnapshot.checkpoints.at(-1)
      updateProjectSnapshot({ checkpoints: [...projectSnapshot.checkpoints, next], changes: [], diff: null })
      updateProjectSnapshot({ changes: previous ? await window.piAgenda.getChanges(previous.hash, next.hash) : [] })
    })
  }

  return {
    project,
    savedProjects,
    isBusy,
    error,
    setError,
    projectPickerOpen,
    setProjectPickerOpen,
    pendingProjectRemoval,
    setPendingProjectRemoval,
    busyTasks,
    setBusyTasks,
    tasks,
    setTasks,
    currentTask,
    query,
    setQuery,
    collapsedProjects,
    setCollapsedProjects,
    searchOpen,
    setSearchOpen,
    projectSnapshot,
    isChatBusy,
    updateProjectSnapshot,
    runAction,
    createProjectTask,
    chooseExistingProject,
    selectTask,
    removeTask,
    removeProject,
    captureCheckpoint,
  }
}
