import type { ChatImage, ChatMessage } from './models'

export interface Conversation {
  id: string
  title: string
  preview: string
  project: string | null
  updatedAt?: number
  messages?: ChatMessage[]
  draft?: string
  draftImages?: ChatImage[]
}

export interface ConversationState {
  version: 1
  tasks: Conversation[]
  selectedId: string | null
}
