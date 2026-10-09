import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PiAgendaApi } from '../shared/api'

const api: PiAgendaApi = {
  loadConversations: () => ipcRenderer.invoke(IPC_CHANNELS.conversationsLoad),
  saveConversations: state => ipcRenderer.invoke(IPC_CHANNELS.conversationsSave, state),
  selectProject: () => ipcRenderer.invoke(IPC_CHANNELS.selectProject),
  openProject: path => ipcRenderer.invoke(IPC_CHANNELS.projectOpen, path),
  openProjectDirectory: path => ipcRenderer.invoke(IPC_CHANNELS.projectDirectory, path),
  removeProject: path => ipcRenderer.invoke(IPC_CHANNELS.projectRemove, path),
  createCheckpoint: label => ipcRenderer.invoke(IPC_CHANNELS.checkpoint, label),
  getChanges: (base, current) => ipcRenderer.invoke(IPC_CHANNELS.changes, base, current),
  getDiff: (base, current, path) => ipcRenderer.invoke(IPC_CHANNELS.diff, base, current, path),
  getModelSettings: () => ipcRenderer.invoke(IPC_CHANNELS.modelSettings),
  saveModelProfile: input => ipcRenderer.invoke(IPC_CHANNELS.modelSave, input),
  deleteModelProfile: id => ipcRenderer.invoke(IPC_CHANNELS.modelDelete, id),
  setActiveModel: id => ipcRenderer.invoke(IPC_CHANNELS.modelActivate, id),
  testModel: (id, requestId) => ipcRenderer.invoke(IPC_CHANNELS.modelTest, id, requestId),
  chatWithModel: (id, requestId, messages, customPrompt) => ipcRenderer.invoke(IPC_CHANNELS.modelChat, id, requestId, messages, customPrompt),
  cancelModelRequest: requestId => ipcRenderer.invoke(IPC_CHANNELS.modelCancel, requestId),
  connectOllama: baseUrl => ipcRenderer.invoke(IPC_CHANNELS.ollamaConnect, baseUrl),
  getOllamaModelInfo: (baseUrl, model) => ipcRenderer.invoke(IPC_CHANNELS.ollamaInfo, baseUrl, model),
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
  onWindowMaximizedChange: callback => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => callback(maximized)
    ipcRenderer.on(IPC_CHANNELS.windowMaximized, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.windowMaximized, listener)
  }
}
contextBridge.exposeInMainWorld('piAgenda', Object.freeze(api))
