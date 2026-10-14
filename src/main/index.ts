import { app, BrowserWindow, net, safeStorage } from 'electron'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../shared/api'
import { ShadowGitManager } from './snapshot/shadow-git-manager'
import { ModelSettingsStore } from './models/model-settings-store'
import { ModelService } from './models/model-service'
import { PiAgentService } from './models/pi-agent-service'
import { registerIpcHandlers } from './ipc-handlers'
import { ChatgptCredentials } from './models/chatgpt-credentials'
import { ChatgptService } from './models/chatgpt-service'
import { SandboxService } from './models/sandbox-service'

let mainWindow: BrowserWindow | null = null
let snapshotManager: ShadowGitManager | undefined
let modelSettings: ModelSettingsStore
let modelService: ModelService
let chatgptService: ChatgptService
let piAgendaDirectory: string
let sandboxService: SandboxService
const mainDirectory = path.dirname(fileURLToPath(import.meta.url))
const rendererFile = path.join(mainDirectory, '../renderer/index.html')
const iconDirectory = app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(app.getAppPath(), 'resources', 'icons')
const windowIcon = path.join(iconDirectory, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
// 开发模式下使用独立的 userData 目录，避免与已安装的正式版实例争用缓存导致 0x5 拒绝访问
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'pi-agenda-dev'))
}
const rendererUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererFile).href
function createWindow(): void {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 960, minHeight: 640, backgroundColor: '#f2f2ee', frame: false, thickFrame: true, icon: windowIcon,
    webPreferences: { preload: path.join(mainDirectory, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)
  mainWindow.webContents.on('render-process-gone', () => modelService.cancelAll())
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) modelService.cancelAll()
  })
  mainWindow.on('closed', () => { modelService.cancelAll(); sandboxService?.stop(); void chatgptService.cancel(); mainWindow = null; snapshotManager = undefined })
  const publishWindowState = (): void => { mainWindow?.webContents.send(IPC_CHANNELS.windowMaximized, mainWindow.isMaximized()) }
  mainWindow.on('maximize', publishWindowState)
  mainWindow.on('unmaximize', publishWindowState)
  mainWindow.webContents.once('did-finish-load', publishWindowState)
  void mainWindow.loadURL(rendererUrl)
}
void app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('dev.piagenda.desktop')
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(iconDirectory, 'icon.png'))
  piAgendaDirectory = path.join(app.getPath('home'), '.pi-agenda')
  const cipher = {
    isAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value)
  }
  modelSettings = new ModelSettingsStore(path.join(app.getPath('userData'), 'model-settings.json'), cipher)
  // 订阅网络沿用 Electron 的系统代理；不向授权接口或模型接口发送浏览器 Cookie。
  const subscriptionFetch: typeof fetch = (input, init) => net.fetch(input instanceof URL ? input.href : input, { ...init, credentials: 'omit' })
  chatgptService = new ChatgptService(new ChatgptCredentials(path.join(app.getPath('userData'), 'chatgpt-auth.enc'), cipher), modelSettings, subscriptionFetch)
  const sandboxRuntimeDirectory = path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), 'sandbox-runtime')
  sandboxService = new SandboxService({ runtimeDirectory: sandboxRuntimeDirectory, dataDirectory: path.join(piAgendaDirectory, 'command-sandbox'), protectedDirectories: [piAgendaDirectory, app.getPath('userData')], emit: state => { mainWindow?.webContents.send(IPC_CHANNELS.sandboxState, state) } })
  modelService = new ModelService(modelSettings, new PiAgentService({ dataDirectory: piAgendaDirectory, protectedDirectories: [app.getPath('userData')], sandboxRuntimeDirectory: path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), 'sandbox-runtime'), chatgpt: chatgptService,
    sandbox: sandboxService,
    getProject: () => snapshotManager?.getRoot(), emit: event => { mainWindow?.webContents.send(IPC_CHANNELS.agentEvent, event) } }))
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getSnapshotManager: () => snapshotManager,
    getModelSettings: () => modelSettings,
    getModelService: () => modelService,
    getChatgptService: () => chatgptService,
    getSandboxService: () => sandboxService,
    setSnapshotManager: manager => { snapshotManager = manager },
    dataDirectory: piAgendaDirectory,
    rendererUrl,
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { sandboxService?.stop(); void chatgptService?.cancel() })
