import { clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import path from 'node:path'
import { ConversationStore } from './conversation-store'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../shared/api'
import { ShadowGitManager } from './snapshot/shadow-git-manager'
import { ModelSettingsStore } from './models/model-settings-store'
import { ModelService, modelResult } from './models/model-service'
import type { ChatgptService } from './models/chatgpt-service'
import { ModelError } from './models/model-validation'
import type { SandboxService } from './models/sandbox-service'
import { performFileAction } from './file-actions'
import type { FileAction } from '../shared/api'

interface IpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null
  getSnapshotManager: () => ShadowGitManager | undefined
  getModelSettings: () => ModelSettingsStore
  getModelService: () => ModelService
  getChatgptService?: () => ChatgptService
  getSandboxService?: () => SandboxService
  setSnapshotManager: (manager: ShadowGitManager | undefined) => void
  dataDirectory: string
  rendererUrl: string
}

function isTrustedRendererUrl(actualUrl: string, expectedUrl: string): boolean {
  try {
    const actual = new URL(actualUrl)
    const expected = new URL(expectedUrl)
    if (actual.protocol !== expected.protocol) return false
    if (actual.protocol === 'file:') {
      const actualPath = path.resolve(fileURLToPath(actual))
      const expectedPath = path.resolve(fileURLToPath(expected))
      return process.platform === 'win32' ? actualPath.toLowerCase() === expectedPath.toLowerCase() : actualPath === expectedPath
    }
    return actual.origin === expected.origin && actual.pathname === expected.pathname
  } catch {
    return false
  }
}

function parseString(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('无效请求参数')
  return value
}

export function registerIpcHandlers(dependencies: IpcHandlerDependencies): void {
  const chatgpt = (): ChatgptService => {
    const service = dependencies.getChatgptService?.()
    if (!service) throw new Error('ChatGPT 订阅服务尚未初始化')
    return service
  }
  const conversations = new ConversationStore(path.join(dependencies.dataDirectory, 'conversations.json'))
  let permissionsLoaded = false
  const loadPermissions = (): import('../shared/conversations').ConversationState => {
    const state = conversations.load()
    if (!permissionsLoaded) {
      for (const task of state.tasks) dependencies.getModelService().setPermission(task.id, task.permissionMode ?? 'default')
      permissionsLoaded = true
    }
    return state
  }
  const requireSnapshotManager = (): ShadowGitManager => {
    const manager = dependencies.getSnapshotManager()
    if (!manager) throw new Error('请先选择项目')
    return manager
  }

  const handle = (channel: string, action: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = dependencies.getMainWindow()
      const frame = event.senderFrame
      const mainFrame = event.sender.mainFrame
      const trustedSender = !!window && event.sender === window.webContents && !!frame && frame.processId === mainFrame.processId && frame.routingId === mainFrame.routingId
      if (!trustedSender || !isTrustedRendererUrl(frame.url, dependencies.rendererUrl)) {
        if (channel.startsWith('models:')) return { ok: false, error: '请求来源与当前应用页面不匹配，请重启应用后重试' }
        throw new Error('拒绝不可信的 IPC 请求')
      }
      return action(...args)
    })
  }

  handle(IPC_CHANNELS.conversationsLoad, () => loadPermissions())
  handle(IPC_CHANNELS.fileAction, (project, file, action) => performFileAction(parseString(project), parseString(file), parseString(action) as FileAction))
  const sandbox = (): SandboxService => {
    const service = dependencies.getSandboxService?.()
    if (!service) throw new ModelError('安全执行环境尚未初始化')
    return service
  }
  handle(IPC_CHANNELS.sandboxStatus, () => modelResult(async () => sandbox().status(requireSnapshotManager().getRoot())))
  handle(IPC_CHANNELS.sandboxEnsure, () => modelResult(async () => {
    return sandbox().ensure(requireSnapshotManager().getRoot())
  }))
  handle(IPC_CHANNELS.sandboxStart, action => modelResult(async () => {
    if (!['configure', 'diagnose', 'check'].includes(String(action))) throw new ModelError('安全执行操作无效')
    if (dependencies.getModelService().isBusy()) throw new ModelError('请先停止当前任务，再配置或排查安全执行环境')
    return sandbox().start(requireSnapshotManager().getRoot(), action as 'configure' | 'diagnose' | 'check')
  }))
  handle(IPC_CHANNELS.sandboxStop, () => modelResult(async () => { sandbox().stop() }))
  handle(IPC_CHANNELS.planInteraction, (requestId, conversationId, interactionId, response) => modelResult(async () => dependencies.getModelService().respondPlanInteraction(requestId, conversationId, interactionId, response)))
  handle(IPC_CHANNELS.permissionMode, (id, mode) => modelResult(async () => {
    const conversationId = parseString(id)
    loadPermissions()
    const service = dependencies.getModelService()
    if (service.isBusy()) throw new ModelError('请先停止当前任务，再切换权限')
    if (mode === 'full' && service.permission(conversationId) !== 'full') {
      if (!await service.confirmFullPermission(conversationId)) return service.permission(conversationId)
    }
    const previousMode = service.permission(conversationId)
    const result = service.setPermission(conversationId, mode)
    try {
      const state = conversations.load()
      if (state.tasks.some(task => task.id === conversationId)) conversations.save({ ...state, tasks: state.tasks.map(task => task.id === conversationId ? { ...task, permissionMode: result } : task) })
    } catch { service.setPermission(conversationId, previousMode); throw new ModelError('权限未能保存，已恢复原权限。请检查磁盘空间和访问权限后重试。') }
    return result
  }))
  handle(IPC_CHANNELS.toolApproval, (requestId, conversationId, approvalId, allow) => modelResult(async () => dependencies.getModelService().respondApproval(requestId, conversationId, approvalId, allow)))
  handle(IPC_CHANNELS.toolApprovalPreview, (requestId, conversationId, approvalId) => modelResult(() => dependencies.getModelService().approvalPreview(requestId, conversationId, approvalId)))
  handle(IPC_CHANNELS.conversationsSave, async state => {
    const previous = loadPermissions()
    // 权限只能通过独立的设置入口改变，普通会话保存不能提升执行权限。
    const value = state as import('../shared/conversations').ConversationState
    if (!value || !Array.isArray(value.tasks)) throw new Error('会话文件格式无效')
    conversations.save({ ...value, tasks: value.tasks.map(task => ({ ...task, permissionMode: dependencies.getModelService().permission(task.id) })) })
    const remaining = new Set((state as import('../shared/conversations').ConversationState).tasks.map(task => task.id))
    for (const task of previous.tasks) if (!remaining.has(task.id)) await dependencies.getModelService().removeHistory(task.id)
  })
  handle(IPC_CHANNELS.selectProject, async () => {
    const window = dependencies.getMainWindow()
    if (!window) throw new Error('应用窗口尚未准备就绪')
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (result.canceled) return null
    const manager = await ShadowGitManager.open(result.filePaths[0], dependencies.dataDirectory)
    dependencies.setSnapshotManager(manager)
    return manager.getRoot()
  })
  handle(IPC_CHANNELS.projectPick, async () => {
    const window = dependencies.getMainWindow()
    if (!window) throw new Error('应用窗口尚未准备就绪')
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (result.canceled) return null
    return result.filePaths[0]
  })
  handle(IPC_CHANNELS.projectOpen, async value => {
    const root = parseString(value)
    if (!path.isAbsolute(root)) throw new Error('项目路径必须是绝对路径')
    const manager = await ShadowGitManager.open(root, dependencies.dataDirectory)
    dependencies.setSnapshotManager(manager)
    return manager.getRoot()
  })
  handle(IPC_CHANNELS.projectRebind, async (previousValue, nextValue) => {
    const previous = parseString(previousValue), next = parseString(nextValue)
    if (!path.isAbsolute(previous) || !path.isAbsolute(next)) throw new Error('项目路径必须是绝对路径')
    if (dependencies.getModelService().isBusy()) throw new Error('请结束当前任务后再修改项目路径')
    if (dependencies.getSandboxService?.()?.busy) throw new Error('安全执行环境正在准备，请完成后再修改项目路径')
    const manager = await ShadowGitManager.open(next, dependencies.dataDirectory)
    await dependencies.getSandboxService?.()?.rebindProject(previous, manager.getRoot())
    dependencies.setSnapshotManager(manager)
    return manager.getRoot()
  })
  handle(IPC_CHANNELS.projectRemove, async value => {
    const root = parseString(value)
    if (!path.isAbsolute(root)) throw new Error('项目路径必须是绝对路径')
    const canonicalRoot = await ShadowGitManager.removeProjectStorage(root, dependencies.dataDirectory)
    if (dependencies.getSnapshotManager()?.getRoot() === canonicalRoot) dependencies.setSnapshotManager(undefined)
  })
  handle(IPC_CHANNELS.projectDirectory, async value => {
    const root = parseString(value)
    const currentRoot = requireSnapshotManager().getRoot()
    if (!path.isAbsolute(root) || path.resolve(root) !== path.resolve(currentRoot)) throw new Error('只能打开当前项目目录')
    const error = await shell.openPath(currentRoot)
    if (error) throw new Error('无法打开项目目录，请检查目录是否存在')
  })
  let restoringFiles = false
  handle(IPC_CHANNELS.checkpoint, label => {
    if (restoringFiles) throw new Error('正在恢复文件，请完成后再创建快照')
    return requireSnapshotManager().createCheckpoint(parseString(label))
  })
  handle(IPC_CHANNELS.changes, async (base, current, project) => {
    const root = project === undefined ? undefined : parseString(project)
    if (root && !path.isAbsolute(root)) throw new Error('项目路径必须是绝对路径')
    const manager = root ? await ShadowGitManager.open(root, dependencies.dataDirectory) : requireSnapshotManager()
    return manager.getChanges(parseString(base), parseString(current))
  })
  const snapshotForProject = async (project: unknown): Promise<ShadowGitManager> => {
    if (project === undefined) return requireSnapshotManager()
    const root = parseString(project)
    if (!path.isAbsolute(root)) throw new Error('项目路径必须是绝对路径')
    return ShadowGitManager.open(root, dependencies.dataDirectory)
  }
  handle(IPC_CHANNELS.rollback, async (base, current, project) => {
    if (dependencies.getModelService().isBusy()) throw new Error('请先停止代理任务再撤销或重做文件修改')
    if (restoringFiles) throw new Error('正在恢复文件，请完成后再撤销或重做')
    restoringFiles = true
    try {
      const manager = await snapshotForProject(project)
      return await manager.rollback(parseString(base), parseString(current))
    } finally { restoringFiles = false }
  })
  handle(IPC_CHANNELS.diff, async (base, current, file, project) => {
    const manager = await snapshotForProject(project)
    return manager.getDiff(parseString(base), parseString(current), parseString(file))
  })
  handle(IPC_CHANNELS.restore, async (target, project) => {
    if (dependencies.getModelService().isBusy()) throw new Error('请先停止代理任务再恢复项目文件')
    if (restoringFiles) throw new Error('正在恢复文件，请完成后再恢复其他轮次')
    restoringFiles = true
    try {
      const manager = await snapshotForProject(project)
      return await manager.restoreCheckpoint(parseString(target))
    } finally { restoringFiles = false }
  })
  handle(IPC_CHANNELS.matches, async (hashes, project) => {
    if (!Array.isArray(hashes) || hashes.some(hash => typeof hash !== 'string')) throw new Error('快照列表无效')
    const manager = await snapshotForProject(project)
    return manager.getMatchingCheckpoints(hashes as string[])
  })
  handle(IPC_CHANNELS.modelSettings, () => modelResult(() => dependencies.getModelSettings().list()))
  handle(IPC_CHANNELS.chatgptStatus, () => modelResult(() => chatgpt().status()))
  handle(IPC_CHANNELS.chatgptStart, () => modelResult(async () => { if (dependencies.getModelService().isBusy()) throw new ModelError('请先停止模型请求再授权账号'); return chatgpt().start() }))
  handle(IPC_CHANNELS.chatgptOpen, () => modelResult(async () => { await shell.openExternal(await chatgpt().authorizationUrl()) }))
  handle(IPC_CHANNELS.chatgptCopy, () => modelResult(async () => { clipboard.writeText(await chatgpt().authorizationUrl()) }))
  handle(IPC_CHANNELS.chatgptSubmit, url => modelResult(() => chatgpt().submit(url)))
  handle(IPC_CHANNELS.chatgptCancel, () => modelResult(() => chatgpt().cancel()))
  handle(IPC_CHANNELS.chatgptLogout, () => modelResult(async () => { if (dependencies.getModelService().isBusy()) throw new ModelError('请先停止模型请求再退出账号'); await chatgpt().logout() }))
  handle(IPC_CHANNELS.chatgptModels, () => modelResult(() => chatgpt().refreshModels()))
  handle(IPC_CHANNELS.chatgptInfo, model => modelResult(() => chatgpt().modelInfo(model)))
  handle(IPC_CHANNELS.chatgptUsage, () => modelResult(() => chatgpt().usage()))
  handle(IPC_CHANNELS.modelSave, input => modelResult(() => dependencies.getModelSettings().save(input)))
  handle(IPC_CHANNELS.modelActivate, id => modelResult(() => dependencies.getModelSettings().setActive(id)))
  handle(IPC_CHANNELS.modelTest, (id, requestId) => modelResult(() => dependencies.getModelService().request(id, requestId, null, true)))
  handle(IPC_CHANNELS.modelChat, (id, requestId, messages, customPrompt, context, agent) => modelResult(() => { if (restoringFiles) throw new ModelError('正在恢复文件，请完成后再发送消息'); loadPermissions(); return dependencies.getModelService().request(id, requestId, messages, false, customPrompt, context, agent) }))
  handle(IPC_CHANNELS.agentHistory, id => modelResult(() => dependencies.getModelService().history(id)))
  handle(IPC_CHANNELS.modelCancel, requestId => modelResult(() => dependencies.getModelService().cancel(requestId)))
  handle(IPC_CHANNELS.ollamaConnect, baseUrl => modelResult(() => dependencies.getModelService().connectOllama(baseUrl)))
  handle(IPC_CHANNELS.ollamaInfo, (baseUrl, model) => modelResult(() => dependencies.getModelService().getOllamaModelInfo(baseUrl, model)))
  handle(IPC_CHANNELS.windowMinimize, () => { dependencies.getMainWindow()?.minimize() })
  handle(IPC_CHANNELS.windowToggleMaximize, () => {
    const window = dependencies.getMainWindow()
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  handle(IPC_CHANNELS.windowClose, () => { dependencies.getMainWindow()?.close() })
}
