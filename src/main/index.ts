import { app, BrowserWindow, safeStorage } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC_CHANNELS } from '../shared/api'
import { ShadowGitManager } from './snapshot/shadow-git-manager'
import { ModelSettingsStore } from './models/model-settings-store'
import { ModelService } from './models/model-service'
import { registerIpcHandlers } from './ipc-handlers'

let mainWindow: BrowserWindow | null = null
let snapshotManager: ShadowGitManager | undefined
let modelSettings: ModelSettingsStore
let modelService: ModelService
let piConsoleDirectory: string
const rendererFile = path.join(__dirname, '../renderer/index.html')
const rendererUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererFile).href
function createWindow(): void {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 960, minHeight: 640, backgroundColor: '#f2f2ee', frame: false, thickFrame: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)
  mainWindow.webContents.on('render-process-gone', () => modelService.cancelAll())
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) modelService.cancelAll()
  })
  mainWindow.on('closed', () => { modelService.cancelAll(); mainWindow = null; snapshotManager = undefined })
  const publishWindowState = (): void => { mainWindow?.webContents.send(IPC_CHANNELS.windowMaximized, mainWindow.isMaximized()) }
  mainWindow.on('maximize', publishWindowState)
  mainWindow.on('unmaximize', publishWindowState)
  mainWindow.webContents.once('did-finish-load', publishWindowState)
  void mainWindow.loadURL(rendererUrl)
}
void app.whenReady().then(() => {
  piConsoleDirectory = path.join(app.getPath('home'), '.pi-console')
  modelSettings = new ModelSettingsStore(path.join(app.getPath('userData'), 'model-settings.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: value => safeStorage.encryptString(value),
    decrypt: value => safeStorage.decryptString(value)
  })
  modelService = new ModelService(modelSettings)
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getSnapshotManager: () => snapshotManager,
    getModelSettings: () => modelSettings,
    getModelService: () => modelService,
    setSnapshotManager: manager => { snapshotManager = manager },
    dataDirectory: piConsoleDirectory,
    rendererUrl,
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
