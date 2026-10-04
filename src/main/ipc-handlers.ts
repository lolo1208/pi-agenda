import { dialog, ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../shared/api'
import { ShadowGitManager } from './snapshot/shadow-git-manager'
import { ModelSettingsStore } from './models/model-settings-store'
import { ModelService, modelResult } from './models/model-service'

interface IpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null
  getSnapshotManager: () => ShadowGitManager | undefined
  getModelSettings: () => ModelSettingsStore
  getModelService: () => ModelService
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

  handle(IPC_CHANNELS.selectProject, async () => {
    const window = dependencies.getMainWindow()
    if (!window) throw new Error('应用窗口尚未准备就绪')
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (result.canceled) return null
    const manager = await ShadowGitManager.open(result.filePaths[0], dependencies.dataDirectory)
    dependencies.setSnapshotManager(manager)
    return manager.getRoot()
  })
  handle(IPC_CHANNELS.projectOpen, async value => {
    const root = parseString(value)
    if (!path.isAbsolute(root)) throw new Error('项目路径必须是绝对路径')
    const manager = await ShadowGitManager.open(root, dependencies.dataDirectory)
    dependencies.setSnapshotManager(manager)
    return manager.getRoot()
  })
  handle(IPC_CHANNELS.projectRemove, async value => {
    const root = parseString(value)
    if (!path.isAbsolute(root)) throw new Error('项目路径必须是绝对路径')
    const canonicalRoot = await ShadowGitManager.removeProjectStorage(root, dependencies.dataDirectory)
    if (dependencies.getSnapshotManager()?.getRoot() === canonicalRoot) dependencies.setSnapshotManager(undefined)
  })
  handle(IPC_CHANNELS.checkpoint, label => requireSnapshotManager().createCheckpoint(parseString(label)))
  handle(IPC_CHANNELS.changes, (base, current) => requireSnapshotManager().getChanges(parseString(base), parseString(current)))
  handle(IPC_CHANNELS.diff, (base, current, file) => requireSnapshotManager().getDiff(parseString(base), parseString(current), parseString(file)))
  handle(IPC_CHANNELS.modelSettings, () => modelResult(() => dependencies.getModelSettings().list()))
  handle(IPC_CHANNELS.modelSave, input => modelResult(() => dependencies.getModelSettings().save(input)))
  handle(IPC_CHANNELS.modelDelete, id => modelResult(() => dependencies.getModelSettings().delete(id)))
  handle(IPC_CHANNELS.modelActivate, id => modelResult(() => dependencies.getModelSettings().setActive(id)))
  handle(IPC_CHANNELS.modelTest, (id, requestId) => modelResult(() => dependencies.getModelService().request(id, requestId, null, true)))
  handle(IPC_CHANNELS.modelChat, (id, requestId, messages) => modelResult(() => dependencies.getModelService().request(id, requestId, messages, false)))
  handle(IPC_CHANNELS.modelCancel, requestId => modelResult(() => dependencies.getModelService().cancel(requestId)))
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
