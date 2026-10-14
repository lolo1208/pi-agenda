import type { AgentEvent, AgentRequestOptions, ChatMessage, ModelDescriptor, ModelReply, ModelResult, ModelSettings, SaveModelProfile } from './models'
export interface Checkpoint { hash: string; createdAt: string; label: string }
export interface ChangedFile { path: string; status: 'A' | 'M' | 'D'; additions: number; deletions: number; binary: boolean }
export interface FileDiff { path: string; before: string; after: string; binary: boolean; hunks?: string[] }
export type FileAction = 'copy-file' | 'copy-path' | 'open-directory' | 'open-file'
import type { ConversationState } from './conversations'
export interface PiAgendaApi {
  performFileAction(project: string, path: string, action: FileAction): Promise<void>
  getSandboxStatus(): Promise<ModelResult<import('./sandbox').SandboxState>>
  ensureSandbox(): Promise<ModelResult<import('./sandbox').SandboxState>>
  startSandbox(action: 'configure' | 'diagnose' | 'check'): Promise<ModelResult<import('./sandbox').SandboxState>>
  stopSandbox(): Promise<ModelResult<void>>
  onSandboxState(callback: (state: import('./sandbox').SandboxState) => void): () => void
  respondPlanInteraction(requestId: string, conversationId: string, interactionId: string, response: import('./models').PlanResponse): Promise<ModelResult<void>>
  getToolApprovalPreview(requestId: string, conversationId: string, approvalId: string): Promise<ModelResult<import('./models').ToolApprovalPreview>>
  setPermissionMode(conversationId: string, mode: import('./models').PermissionMode): Promise<ModelResult<import('./models').PermissionMode>>
  respondToolApproval(requestId: string, conversationId: string, approvalId: string, allow: boolean): Promise<ModelResult<void>>
  getChatgptAuth(): Promise<ModelResult<import('./models').ChatgptAuthStatus>>
  startChatgptAuth(): Promise<ModelResult<import('./models').ChatgptAuthStatus>>
  openChatgptAuth(): Promise<ModelResult<void>>
  copyChatgptAuthLink(): Promise<ModelResult<void>>
  submitChatgptCallback(url: string): Promise<ModelResult<void>>
  cancelChatgptAuth(): Promise<ModelResult<void>>
  logoutChatgpt(): Promise<ModelResult<void>>
  refreshChatgptModels(): Promise<ModelResult<ModelSettings>>
  getChatgptModelInfo(model: string): Promise<ModelResult<ModelDescriptor>>
  getChatgptUsage(): Promise<ModelResult<import('./models').ChatgptUsage>>
  loadConversations(): Promise<ConversationState>
  saveConversations(state: ConversationState): Promise<void>
  selectProject(): Promise<string | null>
  pickProjectDirectory(): Promise<string | null>
  openProject(path: string): Promise<string>
  rebindProject(previousPath: string, nextPath: string): Promise<string>
  openProjectDirectory(path: string): Promise<void>
  removeProject(path: string): Promise<void>
  createCheckpoint(label: string): Promise<Checkpoint>
  getChanges(base: string, current: string, project?: string): Promise<ChangedFile[]>
  getDiff(base: string, current: string, path: string, project?: string): Promise<FileDiff>
  rollbackCheckpoint(base: string, current: string, project?: string): Promise<Checkpoint>
  restoreCheckpoint(target: string, project?: string): Promise<Checkpoint>
  getMatchingCheckpoints(hashes: string[], project?: string): Promise<string[]>
  getModelSettings(): Promise<ModelResult<ModelSettings>>
  saveModelProfile(input: SaveModelProfile): Promise<ModelResult<ModelSettings>>
  setActiveModel(id: string): Promise<ModelResult<ModelSettings>>
  testModel(id: string, requestId: string): Promise<ModelResult<ModelReply>>
  chatWithModel(id: string, requestId: string, messages: ChatMessage[], customPrompt?: string, context?: import('./context').ContextOptions, agent?: AgentRequestOptions): Promise<ModelResult<ModelReply>>
  onAgentEvent(callback: (event: AgentEvent) => void): () => void
  getAgentHistory(conversationId: string): Promise<ModelResult<ChatMessage[] | null>>
  cancelModelRequest(requestId: string): Promise<ModelResult<void>>
  connectOllama(baseUrl: string): Promise<ModelResult<ModelSettings>>
  getOllamaModelInfo(baseUrl: string, model: string): Promise<ModelResult<ModelDescriptor>>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<boolean>
  closeWindow(): Promise<void>
  onWindowMaximizedChange(callback: (maximized: boolean) => void): () => void
}
export const IPC_CHANNELS = {
  fileAction: 'files:action',
  sandboxStatus: 'models:sandbox-status', sandboxEnsure: 'models:sandbox-ensure', sandboxStart: 'models:sandbox-start', sandboxStop: 'models:sandbox-stop', sandboxState: 'sandbox:state',
  planInteraction: 'models:plan-interaction',
  toolApprovalPreview: 'models:tool-approval-preview',
  permissionMode: 'models:permission-mode', toolApproval: 'models:tool-approval',
  chatgptStatus: 'models:chatgpt-status', chatgptStart: 'models:chatgpt-start', chatgptOpen: 'models:chatgpt-open', chatgptCopy: 'models:chatgpt-copy',
  chatgptSubmit: 'models:chatgpt-submit', chatgptCancel: 'models:chatgpt-cancel', chatgptLogout: 'models:chatgpt-logout', chatgptModels: 'models:chatgpt-models', chatgptInfo: 'models:chatgpt-info', chatgptUsage: 'models:chatgpt-usage',
  conversationsLoad: 'conversations:load', conversationsSave: 'conversations:save',
  selectProject: 'project:select', checkpoint: 'snapshot:create',
  changes: 'snapshot:changes', diff: 'snapshot:diff', restore: 'snapshot:restore', matches: 'snapshot:matches',
  rollback: 'snapshot:rollback', agentEvent: 'models:agent-event', agentHistory: 'models:agent-history',
  modelSettings: 'models:list', modelSave: 'models:save',
  modelActivate: 'models:activate', modelTest: 'models:test', modelChat: 'models:chat', modelCancel: 'models:cancel',
  ollamaConnect: 'models:ollama-connect', ollamaInfo: 'models:ollama-info',
  windowMinimize: 'window:minimize', windowToggleMaximize: 'window:toggle-maximize', windowClose: 'window:close', windowMaximized: 'window:maximized',
  projectOpen: 'project:open', projectRebind: 'project:rebind', projectRemove: 'project:remove', projectDirectory: 'project:directory', projectPick: 'project:pick'
} as const
