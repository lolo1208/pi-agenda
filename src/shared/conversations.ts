import type { ChatImage, ChatMessage } from './models'

export interface Conversation {
  id: string
  title: string
  /** 用户手动命名后，不再用首条消息覆盖名称。 */
  titleEdited?: boolean
  /** 仅用于本会话，冲突时优先于项目和全局提示词。 */
  prompt?: string
  preview: string
  project: string | null
  updatedAt?: number
  /** 已成功完成、但用户尚未查看的回复。 */
  unreadCompletion?: boolean
  messages?: ChatMessage[]
  compaction?: import('./context').ContextCompaction
  draft?: string
  draftImages?: ChatImage[]
  /** 会话内用户指定的模型；为空时新会话回退到默认模型 */
  modelId?: string
  permissionMode?: import('./models').PermissionMode
  intentMode?: import('./models').IntentMode
  agentSnapshots?: import('./models').AgentSnapshot[]
}

export interface ConversationState {
  version: 1
  tasks: Conversation[]
  selectedId: string | null
}
