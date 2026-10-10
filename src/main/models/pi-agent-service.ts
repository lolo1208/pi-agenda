import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createAgentSession, createExtensionRuntime, SessionManager, SettingsManager, type AgentSession, type ResourceLoader } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import type { ChatMessage, ModelProfile, ModelReply, ModelRateLimit, AgentRequestOptions, AgentEvent } from '../../shared/models'
import type { ContextOptions } from '../../shared/context'
import type { Checkpoint } from '../../shared/api'
import { ShadowGitManager } from '../snapshot/shadow-git-manager'
import { PiAttachments } from './pi-attachments'
import { createPiProvider } from './pi-provider'
import { piProjectTools } from './pi-tools'
import { ModelError, profileId } from './model-validation'
import { useFileResponses } from './model-attachments'
import type { ChatgptService } from './chatgpt-service'

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
export interface PiAgentDependencies {
  dataDirectory: string
  getProject(): string | undefined
  emit(event: AgentEvent): void
  fetchRequest?: typeof fetch
  chatgpt?: ChatgptService
}

export class PiAgentService {
  constructor(private readonly dependencies: PiAgentDependencies) {}
  private directory(id: string): string { return path.join(this.dependencies.dataDirectory, 'agent-sessions', createHash('sha256').update(profileId(id)).digest('hex')) }
  private async manager(id: string, cwd: string): Promise<SessionManager> {
    const directory = this.directory(id)
    await mkdir(directory, { recursive: true })
    const files = (await readdir(directory)).filter(file => file.endsWith('.jsonl'))
    if (files.length > 1) throw new ModelError('代理会话存在多个记录文件，请检查本地会话数据')
    return files.length ? SessionManager.open(path.join(directory, files[0]), directory, cwd) : SessionManager.create(cwd, directory)
  }
  async history(id: string): Promise<ChatMessage[] | null> {
    const directory = this.directory(id)
    try {
      const files = (await readdir(directory)).filter(file => file.endsWith('.jsonl'))
      if (!files.length) return null
      return this.transcript(SessionManager.open(path.join(directory, files[0]), directory))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new ModelError('无法恢复代理会话，请检查本地会话文件')
    }
  }
  async remove(id: string): Promise<void> { await rm(this.directory(id), { recursive: true, force: true }) }
  private transcript(manager: SessionManager): ChatMessage[] {
    const attachments = new Map<string, ChatMessage>()
    for (const entry of manager.getEntries()) if (entry.type === 'custom' && entry.customType === 'pi-agenda-files') {
      const data = entry.data as { id: string; message: ChatMessage }; attachments.set(data.id, data.message)
    }
    return manager.getBranch().flatMap(entry => {
      if (entry.type !== 'message' || (entry.message.role !== 'user' && entry.message.role !== 'assistant')) return []
      const message = entry.message
      const content = typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const original = attachments.get(/\[pi-agenda-files:([\w-]+)\]/.exec(content)?.[1] ?? '')
      return original ? [original] : content.trim() ? [{ role: message.role as 'user' | 'assistant', content }] : []
    })
  }
  async run(profile: ModelProfile, apiKey: string, messages: ChatMessage[], signal: AbortSignal, instruction: string, context: ContextOptions | undefined, options: AgentRequestOptions | undefined, requestId: string, isTest: boolean): Promise<ModelReply> {
    const started = performance.now()
    const project = options?.project ?? undefined
    if (project && path.resolve(project) !== path.resolve(this.dependencies.getProject() ?? '')) throw new ModelError('会话项目与当前打开的项目不匹配，请重新打开项目')
    const cwd = project ?? this.dependencies.dataDirectory
    const manager = options ? await this.manager(options.conversationId, cwd) : SessionManager.inMemory(cwd)
    const attachments = new PiAttachments(manager)
    const responses = useFileResponses(profile, [...this.transcript(manager), ...messages])
    let rateLimits: ModelRateLimit[] = [], before: Checkpoint | undefined, after: Checkpoint | undefined
    let beforePromise: Promise<void> | undefined
    const snapshot = project ? await ShadowGitManager.open(project, this.dependencies.dataDirectory) : undefined
    const publish = (event: Omit<AgentEvent, 'requestId' | 'conversationId'>): void => this.dependencies.emit({ ...event, requestId, conversationId: options?.conversationId ?? requestId })
    const provider = await createPiProvider(profile, apiKey, attachments, responses, limits => { rateLimits = limits }, this.dependencies.fetchRequest, this.dependencies.chatgpt)
    signal.throwIfAborted()
    // 仅首次迁移导入旧聊天；之后以 pi 的完整会话（含工具结果）为准。
    if (!manager.getEntries().some(entry => entry.type === 'message')) for (const message of messages.slice(0, -1)) {
      if (message.role === 'user') {
        const prepared = attachments.prepare(message)
        manager.appendMessage({ role: 'user', content: [{ type: 'text', text: prepared.text }, ...prepared.images], timestamp: Date.now() })
      } else manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: message.content }], timestamp: Date.now(), api: provider.model.api, provider: provider.model.provider, model: profile.model, usage: emptyUsage(), stopReason: 'stop' })
    }
    const threshold = context?.threshold ?? 90
    const window = provider.model.contextWindow
    const reserveTokens = Math.max(profile.maxTokens, Math.ceil(window * (1 - threshold / 100)))
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: !isTest, reserveTokens, keepRecentTokens: Math.max(128, Math.min(20000, Math.floor(window * .25))) }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off', images: { autoResize: false }, enableAnalytics: false, enableInstallTelemetry: false })
    const resourceLoader: ResourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }), getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => isTest ? '' : [project ? '你是 Pi Agenda · 行动派的编程助手。使用工具完成用户任务，文件操作限定在当前项目；命令同样应限定在当前项目。对话、注释与日志以中文为主。' : '你是 Pi Agenda · 行动派的助手，请用中文回答。', instruction].filter(Boolean).join('\n\n'),
      getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {}
    }
    const tools = snapshot ? piProjectTools(snapshot.getRoot(), () => beforePromise ??= snapshot.createCheckpoint('代理修改前').then(checkpoint => { before = checkpoint; publish({ type: 'status', text: '已保存修改前快照' }) })) : []
    let session: AgentSession | undefined
    const roundUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    let unsubscribe: (() => void) | undefined
    const abort = (): void => { if (session) void session.abort() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      session = (await createAgentSession({ cwd, agentDir: path.join(this.dependencies.dataDirectory, 'agent-config'), modelRuntime: provider.runtime, model: provider.model, thinkingLevel: profile.thinking === true || (profile.provider === 'chatgpt' && profile.thinking == null) ? 'medium' : 'off', sessionManager: manager, settingsManager, resourceLoader,
        tools: tools.map(tool => tool.name), customTools: tools })).session
      signal.throwIfAborted()
      unsubscribe = session.subscribe(event => {
        if (event.type === 'message_end' && event.message.role === 'assistant') {
          const usage = event.message.usage
          roundUsage.inputTokens += usage.input + usage.cacheRead + usage.cacheWrite
          roundUsage.outputTokens += usage.output
          roundUsage.cacheReadTokens += usage.cacheRead
          roundUsage.cacheWriteTokens += usage.cacheWrite
        }
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') publish({ type: 'text', text: event.assistantMessageEvent.delta })
        if (event.type === 'message_start' && event.message.role === 'assistant') publish({ type: 'status', text: '正在生成回复…', resetText: true })
        if (event.type === 'message_end' && ['user', 'assistant'].includes(event.message.role)) publish({ type: 'transcript', messages: this.transcript(manager) })
        if (event.type === 'tool_execution_start') publish({ type: 'status', text: `正在执行 ${event.toolName}…` })
        if (event.type === 'tool_execution_end') publish({ type: 'status', text: event.isError ? `${event.toolName} 执行失败，正在处理…` : `${event.toolName} 已完成` })
        if (event.type === 'compaction_start') publish({ type: 'status', text: '正在压缩上下文，完整记录仍保留…' })
        if (event.type === 'compaction_end' && event.errorMessage) publish({ type: 'status', text: '上下文压缩失败，请检查模型服务' })
      })
      const prepared = attachments.prepare(messages.at(-1)!)
      await session.prompt(prepared.text, { images: prepared.images, expandPromptTemplates: false })
      signal.throwIfAborted()
      const final = session.messages.filter((message): message is AssistantMessage => message.role === 'assistant').at(-1)
      if (!final || final.stopReason === 'error' || final.stopReason === 'aborted') throw new ModelError(profile.provider === 'chatgpt' ? 'ChatGPT 订阅请求失败，请检查授权、模型权限与订阅额度后重试' : '模型请求失败，请检查接口、密钥和模型工具调用能力后重试')
      const text = session.getLastAssistantText() ?? ''
      if (!text.trim()) throw new ModelError('模型未返回正文，请提高输出 Token 上限后重试')
      return { text: apiKey ? text.split(apiKey).join('[已隐藏密钥]') : text, model: profile.model, elapsedMs: Math.round(performance.now() - started), truncated: final.stopReason === 'length',
        usage: { inputTokens: final.usage.input + final.usage.cacheRead + final.usage.cacheWrite, outputTokens: final.usage.output }, roundUsage, rateLimits, messages: this.transcript(manager) }
    } finally {
      if (profile.provider === 'chatgpt') this.dependencies.chatgpt?.invalidateUsage()
      signal.removeEventListener('abort', abort)
      if (session) { await session.abort(); unsubscribe?.(); session.dispose() }
      if (before && snapshot) {
        try {
          after = await snapshot.createCheckpoint('代理修改后')
          const round = { project: snapshot.getRoot(), before, after }
          manager.appendCustomEntry('pi-agenda-snapshot', round)
          publish({ type: 'snapshot', snapshot: round })
        } catch { publish({ type: 'status', text: '修改后快照保存失败，请手动捕获当前改动' }) }
      }
      publish({ type: 'transcript', messages: this.transcript(manager) })
    }
  }
}
