import { Button } from '@/components/ui/button'
import React, { useEffect, useState } from 'react'

import { FolderOpen, PanelRightOpen, PlusCircle } from 'lucide-react'
import type { ModelSettings } from '../../shared/models'
import ModelChat from './ModelChat'
import SettingsPage from './SettingsPage'
import { readPreferences, type Preferences } from './preferences'
import { unwrapModelResult } from './model-result'
import { useProjectWorkspace } from './hooks/useProjectWorkspace'
import { UNLINKED_PROJECT_LABEL, type Task } from './app-types'
import { ProjectPickerDialog } from './components/ProjectPickerDialog'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ToolSidebar } from './components/ToolSidebar'
import { WindowTitleBar } from './components/WindowTitleBar'
import './styles.css'
export default function App(): React.JSX.Element {
  const workspace = useProjectWorkspace()
  const {
    project, savedProjects, isBusy, error, setError, projectPickerOpen, setProjectPickerOpen,
    pendingProjectRemoval, setPendingProjectRemoval, busyTasks, setBusyTasks, tasks, setTasks,
    currentTask, query, setQuery, collapsedProjects, setCollapsedProjects, searchOpen, setSearchOpen,
    projectSnapshot, isChatBusy, updateProjectSnapshot, runAction, createProjectTask,
    chooseExistingProject, selectTask, removeTask, removeProject, captureCheckpoint, rollbackCheckpoint,
  } = workspace
  const { checkpoints, changes, diff } = projectSnapshot
  const [preferences, setPreferences] = useState(readPreferences)
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = preferences.theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preferences.theme
  const [settings, setSettings] = useState<ModelSettings | null>(null)
  const [settingsError, setSettingsError] = useState('')
  const [settingsSection, setSettingsSection] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [tool, setTool] = useState<'snapshots' | 'files' | 'terminal' | 'browser'>('snapshots')
  const loadSettings = (): void => {
    setSettingsError('')
    void window.piAgenda.getModelSettings().then(unwrapModelResult).then(setSettings).catch(e => setSettingsError(e instanceof Error ? e.message : '无法读取模型设置'))
  }
  useEffect(loadSettings, [])
  useEffect(() => window.piAgenda.onWindowMaximizedChange?.(setIsMaximized), [])
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setSystemPrefersDark(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.font = preferences.font
    document.documentElement.style.setProperty('--ui-font-size', `${preferences.fontSize}px`)
  }, [resolvedTheme, preferences.font, preferences.fontSize])
  const updatePreferences = (next: Preferences): void => {
    setPreferences(next)
    try { localStorage.setItem('pi-agenda.preferences', JSON.stringify({ ...next, sendWithCtrlEnterVersion: 1 })) } catch { setError('偏好设置未能保存，重启后将恢复默认值。请检查本地存储。') }
  }
  const activeProfile = settings?.profiles.find(item => item.id === settings.activeProfileId)
  const filtered = tasks.filter(item => `${item.title} ${item.preview} ${item.project ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const knownProjects = [...new Set([...savedProjects, ...tasks.map(item => item.project).filter((root): root is string => Boolean(root))])]
  const groupedTasks = new Map<string, Task[]>()
  for (const task of filtered) {
    const group = task.project ?? UNLINKED_PROJECT_LABEL
    groupedTasks.set(group, [...(groupedTasks.get(group) ?? []), task])
  }
  if (!query.trim()) for (const root of knownProjects) if (!groupedTasks.has(root)) groupedTasks.set(root, [])
  return <div className={`window-shell ${toolsOpen ? 'tools-open' : ''}`}>
    <WindowTitleBar
      pageTitle={settingsSection ? '设置' : currentTask?.title ?? ''}
      projectName={settingsSection ? null : currentTask?.project?.split(/[\\/]/).filter(Boolean).at(-1) ?? null}
      isMaximized={isMaximized}
      onMinimize={() => { void window.piAgenda.minimizeWindow() }}
      onToggleMaximize={() => { void window.piAgenda.toggleMaximizeWindow() }}
      onClose={() => { void window.piAgenda.closeWindow() }}
    />
    <div className={`app ${toolsOpen ? 'tools-open' : ''}`} hidden={settingsSection !== null}>
      <ProjectSidebar
        groups={groupedTasks}
        hasMatchingTasks={filtered.length > 0}
        currentTaskId={currentTask?.id}
        busyTaskIds={busyTasks}
        query={query}
        searchOpen={searchOpen}
        collapsedProjects={collapsedProjects}
        pendingProjectRemoval={pendingProjectRemoval}
        isBusy={isBusy}
        isChatBusy={isChatBusy}
        onStartTask={() => { setError(''); setProjectPickerOpen(true) }}
        onToggleSearch={() => setSearchOpen(value => !value)}
        onQueryChange={setQuery}
        onCloseSearch={() => { setQuery(''); setSearchOpen(false) }}
        onToggleProject={root => setCollapsedProjects(items => items.includes(root) ? items.filter(item => item !== root) : [...items, root])}
        onPendingProjectRemovalChange={setPendingProjectRemoval}
        onRemoveProject={removeProject}
        onSelectTask={selectTask}
        onRemoveTask={removeTask}
        onCreateProjectTask={chooseExistingProject}
        onOpenSettings={() => setSettingsSection('general')}
      />
      <main className="conversation">
        <header className="conversation-header"><Button className="icon-button" aria-label={toolsOpen ? '收起工具栏' : '展开工具栏'} aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}><PanelRightOpen size={18} /></Button></header>
        {!currentTask && <section className="no-task-state"><FolderOpen size={30} /><h1>从一个项目开始</h1><p>为新对话选择已有项目，或添加一个新的目录。</p><Button className="project-new-button" onClick={() => setProjectPickerOpen(true)}><PlusCircle size={17} />新建对话</Button></section>}
        {tasks.map(task => <div className="task-chat" key={task.id} hidden={task.id !== currentTask?.id}><ModelChat active={task.id === currentTask?.id && settingsSection === null} conversationId={task.id} compressionThreshold={preferences.compressionThreshold} initialCompaction={task.compaction} onCompactionChange={compaction => setTasks(items => items.map(item => item.id === task.id ? { ...item, compaction } : item))} customPrompt={preferences.customPrompt} project={task.project} providers={settings?.providers} initialMessages={task.messages} initialDraft={task.draft} initialDraftImages={task.draftImages} onDraftChange={(draft, draftImages) => setTasks(items => items.map(item => item.id === task.id && (item.draft !== draft || item.draftImages !== draftImages) ? { ...item, draft, draftImages } : item))} profile={activeProfile} profiles={settings?.profiles} onBusyChange={busy => setBusyTasks(items => busy ? [...items.filter(id => id !== task.id), task.id] : items.filter(id => id !== task.id))} onOpenSettings={() => setSettingsSection('models')} settingsDisabled={isChatBusy} sendWithCtrlEnter={preferences.sendWithCtrlEnter} onMessagesChange={messages => setTasks(items => items.map(item => item.id === task.id ? { ...item, messages, updatedAt: Date.now(), title: messages.find(message => message.role === 'user')?.content.slice(0, 36) || (messages.some(message => message.images?.length) ? '附件对话' : '新建对话'), preview: messages.at(-1)?.content.slice(0, 90) ?? '开始一段新的对话' } : item))} /></div>)}
        {error && <p role="alert" className="error">{error}</p>}
        {settingsError && <p role="alert" className="error">{settingsError}<Button onClick={loadSettings}>重新读取设置</Button></p>}

      </main>
      {toolsOpen && <ToolSidebar
        project={project}
        isBusy={isBusy || isChatBusy}
        activeTool={tool}
        checkpoints={checkpoints}
        changes={changes}
        diff={diff}
        theme={resolvedTheme}
        inlineDiff={preferences.inlineDiff}
        onToolChange={setTool}
        onClose={() => setToolsOpen(false)}
        onCaptureCheckpoint={captureCheckpoint}
        onRollbackCheckpoint={rollbackCheckpoint}
        onSelectDiff={filePath => { void runAction(async () => updateProjectSnapshot({ diff: await window.piAgenda.getDiff(checkpoints.at(-2)!.hash, checkpoints.at(-1)!.hash, filePath) })) }}
      />}
    </div>
    {settingsSection !== null && <SettingsPage initialSection={settingsSection} settings={settings} error={settingsError} reload={loadSettings} preferences={preferences} onPreferences={updatePreferences} onChange={setSettings} onClose={() => setSettingsSection(null)} />}
    {projectPickerOpen && <ProjectPickerDialog
      projects={knownProjects}
      error={error}
      isBusy={isBusy}
      onClose={() => setProjectPickerOpen(false)}
      onOpenProject={chooseExistingProject}
      onChooseProjectDirectory={createProjectTask}
    />}
  </div>
}

