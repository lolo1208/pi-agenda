import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ConversationState } from '../shared/conversations'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会话文件格式无效')
  return value as Record<string, unknown>
}

function images(value: unknown): boolean {
  return value === undefined || Array.isArray(value) && value.every(image => {
    const item = record(image)
    return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.dataUrl === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(item.dataUrl)
  })
}

function parseState(value: unknown): ConversationState {
  const state = record(value)
  if (state.version !== 1 || !Array.isArray(state.tasks) || !(state.selectedId === null || typeof state.selectedId === 'string')) throw new Error('会话文件格式无效')
  const ids = new Set<string>()
  for (const value of state.tasks) {
    const task = record(value)
    if (typeof task.id !== 'string' || !task.id || ids.has(task.id) || typeof task.title !== 'string' || typeof task.preview !== 'string' || !(task.project === null || typeof task.project === 'string') || !(task.updatedAt === undefined || typeof task.updatedAt === 'number' && Number.isFinite(task.updatedAt)) || !(task.draft === undefined || typeof task.draft === 'string') || !images(task.draftImages)) throw new Error('会话文件格式无效')
    ids.add(task.id)
    if (task.messages !== undefined && (!Array.isArray(task.messages) || !task.messages.every(value => {
      const message = record(value)
      return (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && images(message.images)
    }))) throw new Error('会话消息格式无效')
  }
  return state as unknown as ConversationState
}

/** 不设置保留期限；只有用户删除会话时才从保存状态中移除。 */
export class ConversationStore {
  private readable = false
  constructor(private readonly file: string) {}

  load(): ConversationState {
    try {
      const state = parseState(JSON.parse(readFileSync(this.file, 'utf8')))
      this.readable = true
      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.readable = true
        return { version: 1, tasks: [], selectedId: null }
      }
      this.readable = false
      throw new Error('无法读取本地会话，原文件已保留。请检查会话文件或访问权限后重启应用。')
    }
  }

  save(value: unknown): void {
    if (!this.readable) throw new Error('本地会话尚未成功读取，已停止保存以保护原文件。')
    const state = parseState(value)
    mkdirSync(path.dirname(this.file), { recursive: true })
    // 同步写入临时文件并原子替换，关闭窗口时无需等待后台写入。
    writeFileSync(`${this.file}.tmp`, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flush: true })
    renameSync(`${this.file}.tmp`, this.file)
  }
}
