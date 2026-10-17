import { app, BrowserWindow, Menu, net, safeStorage, Tray } from 'electron'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../shared/api'
import { ShadowGitManager } from './snapshot/shadow-git-manager'
import { ModelSettingsStore } from './models/model-settings-store'
import { ModelService } from './models/model-service'
import { PiAgentService } from './models/pi-agent-service'
import { registerIpcHandlers } from './ipc-handlers'
import { closeAllNotifications } from './notifications'
import { ChatgptCredentials } from './models/chatgpt-credentials'
import { ChatgptService } from './models/chatgpt-service'
import { OpenrouterClient } from './models/openrouter-client'
import { SandboxService } from './models/sandbox-service'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let servicesReady = false
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
// 只有首个实例初始化服务和窗口，后续启动交由首个实例恢复界面。
// Electron 的锁按 userData 目录区分；开发版和安装版共享锁，但各自使用原来的数据目录。
const userDataDirectory = app.getPath('userData')
const instanceDirectory = path.join(app.getPath('appData'), 'pi-agenda-instance')
mkdirSync(instanceDirectory, { recursive: true })
app.setPath('userData', instanceDirectory)
let hasSingleInstanceLock: boolean
try {
  hasSingleInstanceLock = app.requestSingleInstanceLock()
} finally {
  app.setPath('userData', userDataDirectory)
}
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 启动初始化尚未完成时，首个实例会在初始化结束后正常显示窗口。
    showMainWindow()
  })
}
const isDevelopment = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
const rendererUrl = isDevelopment ? process.env.ELECTRON_RENDERER_URL! : pathToFileURL(rendererFile).href
function showMainWindow(): void {
  if (isQuitting || !servicesReady) return
  if (!mainWindow) createWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.setSkipTaskbar(false)
  mainWindow?.show()
  mainWindow?.focus()
}
function prepareToQuit(): void {
  if (isQuitting) return
  isQuitting = true
  closeAllNotifications()
  tray?.destroy()
  tray = null
  modelService?.cancelAll()
  sandboxService?.stop()
  void chatgptService?.cancel()
}
function hideToTray(): void {
  if (!tray) {
    tray = new Tray(windowIcon)
    tray.setToolTip('Pi Agenda · 行动派')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开', click: showMainWindow },
      { label: '退出', click: () => app.quit() }
    ]))
    tray.on('double-click', showMainWindow)
  }
  mainWindow?.setSkipTaskbar(true)
  mainWindow?.hide()
}
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
  mainWindow.on('close', event => {
    if (isDevelopment || isQuitting) return
    hideToTray()
    event.preventDefault()
  })
  // Windows 注销或关机不会保证触发 before-quit，确认结束系统会话时也要清理后台任务。
  mainWindow.on('session-end', prepareToQuit)
  mainWindow.on('closed', () => {
    if (!isQuitting) { modelService.cancelAll(); sandboxService?.stop(); void chatgptService.cancel() }
    mainWindow = null
    snapshotManager = undefined
  })
  const publishWindowState = (): void => { mainWindow?.webContents.send(IPC_CHANNELS.windowMaximized, mainWindow.isMaximized()) }
  mainWindow.on('maximize', publishWindowState)
  mainWindow.on('unmaximize', publishWindowState)
  mainWindow.webContents.once('did-finish-load', publishWindowState)
  void mainWindow.loadURL(rendererUrl)
}
if (hasSingleInstanceLock) void app.whenReady().then(() => {
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
    fetchRequest: (input, init) => new URL(input instanceof Request ? input.url : String(input)).hostname === 'openrouter.ai' ? subscriptionFetch(input, init) : fetch(input, init),
    sandbox: sandboxService,
    getProject: () => snapshotManager?.getRoot(), emit: event => { mainWindow?.webContents.send(IPC_CHANNELS.agentEvent, event) } }), undefined, new OpenrouterClient(subscriptionFetch))
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
  servicesReady = true
  createWindow()
  app.on('activate', showMainWindow)
})
app.on('window-all-closed', () => { if (isDevelopment || process.platform !== 'darwin') app.quit() })
app.on('before-quit', prepareToQuit)
