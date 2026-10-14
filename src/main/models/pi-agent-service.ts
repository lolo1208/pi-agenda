import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createAgentSession, createExtensionRuntime, SessionManager, SettingsManager, type AgentSession, type ResourceLoader } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import type { ChatExecution, ChatMessage, ModelProfile, ModelReply, ModelRateLimit, AgentRequestOptions, AgentEvent } from '../../shared/models'
import type { ContextOptions } from '../../shared/context'
import type { Checkpoint } from '../../shared/api'
import { ShadowGitManager } from '../snapshot/shadow-git-manager'
import { PiAttachments } from './pi-attachments'
import { createPiProvider } from './pi-provider'
import { piProjectTools } from './pi-tools'
import { ModelError, profileId } from './model-validation'
import { useFileResponses } from './model-attachments'
import type { ChatgptService } from './chatgpt-service'
import os from 'node:os'
import { ToolApprovalManager } from './tool-permissions'
import { PERMISSION_MODES, type PermissionMode } from '../../shared/models'
import { PlanInteractionManager } from './plan-interactions'
import { PLAN_INSTRUCTION, planTools } from './plan-tools'
import { NativeTerminalSandbox } from './terminal-sandbox'
import type { TerminalSandbox } from './terminal-sandbox'

const toolActions: Record<string, string> = {
  bash: '运行命令',
  powershell: '运行命令',
  read: '读取',
  write: '写入',
  edit: '编辑',
  delete: '删除文件',
  mkdir: '创建目录',
  rmdir: '删除目录',
  move: '移动或重命名',
  copy: '复制',
  stat: '查看文件或目录信息',
  ls: '查看目录',
  find: '查找',
  grep: '搜索',
  ask_user_question: '确认需求',
  submit_plan: '提交计划'
}

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
export interface PiAgentDependencies {
  dataDirectory: string
  getProject(): string | undefined
  emit(event: AgentEvent): void
  fetchRequest?: typeof fetch
  chatgpt?: ChatgptService
  protectedDirectories?: string[]
  sandboxRuntimeDirectory?: string
  sandbox?: TerminalSandbox
}

export class PiAgentService {
  private modes = new Map<string, PermissionMode>()
  private approvals: ToolApprovalManager
  private interactions: PlanInteractionManager
  private sandbox?: TerminalSandbox
  constructor(private readonly dependencies: PiAgentDependencies) {
    this.approvals = new ToolApprovalManager(dependencies.emit)
    this.interactions = new PlanInteractionManager(dependencies.emit)
    if (dependencies.sandboxRuntimeDirectory) this.sandbox = new NativeTerminalSandbox({
      runtimeDirectory: dependencies.sandboxRuntimeDirectory,
      dataDirectory: path.join(dependencies.dataDirectory, 'command-sandbox'),
      protectedDirectories: [dependencies.dataDirectory, dependencies.sandboxRuntimeDirectory, ...(dependencies.protectedDirectories ?? [])]
    })
    if (dependencies.sandbox) this.sandbox = dependencies.sandbox
  }
  respondPlanInteraction(requestId: string, conversationId: string, id: string, response: unknown): void { this.interactions.respond(requestId, conversationId, id, response) }
  permission(id: string): PermissionMode { return this.modes.get(id) ?? 'default' }
  setPermission(id: string, mode: PermissionMode): void {
    if (!PERMISSION_MODES.includes(mode)) throw new ModelError('权限模式无效')
    this.modes.set(id, mode)
  }
  respondApproval(requestId: string, conversationId: string, id: string, allow: boolean): void { this.approvals.respond(requestId, conversationId, id, allow) }
  approvalPreview(requestId: string, conversationId: string, id: string) { return this.approvals.preview(requestId, conversationId, id) }
  confirmFullPermission(conversationId: string, signal: AbortSignal): Promise<boolean> {
    return this.approvals.ask(randomUUID(), conversationId, { toolCallId: randomUUID(), tool: 'full-access', args: {}, cwd: '', reason: '开启完全访问？' }, signal, () => {}, false)
  }
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
  async remove(id: string): Promise<void> { await rm(this.directory(id), { recursive: true, force: true }); this.modes.delete(id) }
  private transcript(manager: SessionManager): ChatMessage[] {
    const attachments = new Map<string, ChatMessage>()
    const executions = new Map<string, ChatExecution>()
    const durations = new Map<string, number>()
    const results = new Map<string, { content: string; isError: boolean }>()
    for (const entry of manager.getBranch()) {
      if (entry.type === 'message' && entry.message.role === 'toolResult') results.set(entry.message.toolCallId, {
        content: entry.message.content.map(block => block.type === 'text' ? block.text : '[图片结果]').join('\n'), isError: entry.message.isError
      })
      if (entry.type === 'custom' && entry.customType === 'pi-agenda-call-duration') {
        const data = entry.data as { messageTimestamp: number; elapsedMs: number }; durations.set(String(data.messageTimestamp), data.elapsedMs)
      }
    }
    const snapshotHashes = new Map<string, string>()
    let lastMessageId: string | undefined
    // 使用原生历史中的快照记录定位轮次，旧会话无需猜测消息序号。
    for (const entry of manager.getBranch()) {
      if (entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant')) {
        const content = entry.message.content
        if (typeof content === 'string' ? content.trim() : content.some(block => block.type === 'text' && block.text.trim())) lastMessageId = entry.id
      }
      if (entry.type === 'custom' && entry.customType === 'pi-agenda-plan-message') lastMessageId = entry.id
      if (entry.type === 'custom' && entry.customType === 'pi-agenda-snapshot' && lastMessageId) {
        const data = entry.data as import('../../shared/models').AgentSnapshot
        snapshotHashes.set(lastMessageId, data.after.hash)
      }
    }
    for (const entry of manager.getEntries()) if (entry.type === 'custom' && entry.customType === 'pi-agenda-execution') {
      const data = entry.data as { entryIds: string[]; execution: ChatExecution }
      for (const id of data.entryIds) executions.set(id, data.execution)
    }
    for (const entry of manager.getEntries()) if (entry.type === 'custom' && entry.customType === 'pi-agenda-files') {
      const data = entry.data as { id: string; message: ChatMessage }; attachments.set(data.id, data.message)
    }
    return manager.getBranch().flatMap(entry => {
      if (entry.type === 'custom' && entry.customType === 'pi-agenda-plan-message') return [{ ...entry.data as ChatMessage, ...(snapshotHashes.has(entry.id) ? { snapshotHash: snapshotHashes.get(entry.id) } : {}) }]
      if (entry.type !== 'message' || (entry.message.role !== 'user' && entry.message.role !== 'assistant')) return []
      const message = entry.message
      const content = typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const original = attachments.get(/\[pi-agenda-files:([\w-]+)\]/.exec(content)?.[1] ?? '')
      const execution = executions.get(entry.id)
      const call = message.role === 'assistant' ? {
        elapsedMs: durations.get(String(message.timestamp)),
        work: message.content.flatMap((block, index): import('../../shared/models').ChatWorkItem[] => {
          if (block.type === 'thinking') return [{ id: `${entry.id}-${index}`, kind: 'thinking', content: block.thinking }]
          if (block.type !== 'toolCall') return []
          const result = results.get(block.id)
          return [{ id: block.id, kind: 'tool', name: block.name, args: block.arguments, content: result?.content ?? '', completed: Boolean(result), isError: result?.isError }]
        })
      } : undefined
      return original ? [{ ...original, ...(snapshotHashes.has(entry.id) ? { snapshotHash: snapshotHashes.get(entry.id) } : {}) }] : content.trim() || call?.work.length ? [{ role: message.role as 'user' | 'assistant', content,
        ...(call ? { call } : {}),
        ...(snapshotHashes.has(entry.id) ? { snapshotHash: snapshotHashes.get(entry.id) } : {}),
        ...(execution ? { execution } : message.role === 'assistant' ? { execution: { model: message.model } } : {}) }] : []
    })
  }
  async run(profile: ModelProfile, apiKey: string, messages: ChatMessage[], signal: AbortSignal, instruction: string, context: ContextOptions | undefined, options: AgentRequestOptions | undefined, requestId: string, isTest: boolean, onApprovalWaiting: (waiting: boolean) => void = () => {}): Promise<ModelReply> {
    const started = performance.now()
    const project = options?.project ?? undefined
    if (project && path.resolve(project) !== path.resolve(this.dependencies.getProject() ?? '')) throw new ModelError('会话项目与当前打开的项目不匹配，请重新打开项目')
    const cwd = project ?? os.homedir()
    const mode = options ? this.permission(options.conversationId) : 'default'
    let planning = !isTest && options?.intentMode === 'plan'
    let clarified = false, interactionVersion = 0
    const manager = options ? await this.manager(options.conversationId, cwd) : SessionManager.inMemory(cwd)
    const attachments = new PiAttachments(manager)
    const responses = useFileResponses(profile, [...this.transcript(manager), ...messages])
    let rateLimits: ModelRateLimit[] = [], before: Checkpoint | undefined, after: Checkpoint | undefined
    let beforePromise: Promise<void> | undefined
    const snapshot = project ? await ShadowGitManager.open(project, this.dependencies.dataDirectory) : undefined
    const publish = (event: Omit<AgentEvent, 'requestId' | 'conversationId'>): void => this.dependencies.emit({ ...event, requestId, conversationId: options?.conversationId ?? requestId })
    const activeTools = new Map<string, string>()
    const waitingTools = new Map<string, string>()
    let modelStatus = '正在连接模型…', lastStatus = ''
    const status = (text: string, resetText = false): void => {
      if (text === lastStatus && !resetText) return
      lastStatus = text
      publish({ type: 'status', text, ...(resetText ? { resetText: true } : {}) })
    }
    const refreshStatus = (): void => {
      if (signal.aborted) { status('正在停止任务…'); return }
      const actions = [...new Set([...activeTools].filter(([id, name]) => !waitingTools.has(id) && !(waitingTools.has('plan-interaction') && ['ask_user_question', 'submit_plan'].includes(name))).map(([, name]) => toolActions[name] ?? '执行任务'))]
      const waiting = [...new Set(waitingTools.values())]
      status([...actions.map(action => `正在${action}...`), ...waiting].join('；') || modelStatus)
    }
    const waitingFor = (id: string, text: string) => (waiting: boolean): void => {
      if (waiting) waitingTools.set(id, text)
      else waitingTools.delete(id)
      onApprovalWaiting(waitingTools.size > 0)
      refreshStatus()
    }
    status(modelStatus)
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
      getSystemPrompt: () => isTest ? '' : ['你是 Pi Agenda · 行动派的助手。对话、注释与日志以中文为主。', `当前权限模式：${mode}。默认权限的文件和目录修改及命令需审批；自动审批允许项目内普通文件和目录的创建、修改、删除、查询、移动、重命名和复制；完全访问允许项目外普通文件和目录访问。文件和目录操作必须优先使用专用工具，不要用终端命令代替：mkdir 创建目录，write 写入文件，edit 修改文件，delete 删除文件，rmdir 删除目录（删除非空目录时设置 recursive=true），move 移动或重命名，copy 复制，stat 查看信息，ls 查看目录内容，find 查找文件或目录，grep 搜索文件内容，read 读取文件。批量操作先用 find 查找，再逐项调用对应工具。执行模式下，用户已经明确要求的项目内文件和目录操作直接调用工具，是否需要审批由应用执行，不要额外询问执行许可。自动审批的复合脚本和其他终端命令在系统沙箱内直接运行，项目外访问和联网会被系统拦截；不要仅因命令复杂就询问许可。只有明确需要沙箱外权限时才设置 outsideSandbox=true。沙箱或程序返回错误后先根据错误调整实现，不要自动申请本机权限。Windows PowerShell 5 的 Remove-Item 等路径命令可能访问项目祖先而被拒绝，优先使用专用文件工具或项目内 System.IO API。用户拒绝后请调整方案，不要变换语法重试相同动作。${project ? `当前项目：${project}` : '未绑定项目，不存在自动授权的工作区。'}`, instruction, planning ? PLAN_INSTRUCTION : '当前为执行模式。若本轮计划已批准，请按批准内容执行。'].filter(Boolean).join('\n\n'),
      getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {}
    }
    const projectTools = isTest || !options ? [] : piProjectTools(snapshot?.getRoot() ?? cwd, () => snapshot ? beforePromise ??= (async () => {
      status('正在保存修改前快照…')
      try { before = await snapshot.createCheckpoint('代理修改前') }
      finally { refreshStatus() }
    })() : Promise.resolve(), {
      mode, project: snapshot?.getRoot(), protectedDirectories: [this.dependencies.dataDirectory, path.join(os.homedir(), '.pi-agenda-execution'), ...(this.dependencies.sandboxRuntimeDirectory ? [this.dependencies.sandboxRuntimeDirectory] : []), ...(this.dependencies.protectedDirectories ?? [])],
      sandbox: this.sandbox,
      approve: (id, tool, args, reason, toolSignal) => this.approvals.ask(requestId, options.conversationId, { toolCallId: id, tool, args: structuredClone(args), cwd, reason }, toolSignal ?? signal, waitingFor(id, `等待你批准${toolActions[tool] ?? '操作'}…`)).then(() => {})
    })
    let session: AgentSession | undefined
    const planningTools = (): string[] => ['read', 'ls', 'find', 'grep', 'stat', 'ask_user_question', ...(clarified ? ['submit_plan'] : [])]
    const guardedTools = projectTools.map(tool => ({ ...tool, execute: async (...args: Parameters<typeof tool.execute>) => {
      if (planning && !['read', 'ls', 'find', 'grep', 'stat'].includes(tool.name)) throw new ModelError('计划尚未批准，不能修改文件或执行终端命令。请先澄清需求并提交计划。')
      return tool.execute(...args)
    } }))
    const interactions = planning && options ? planTools(
      async (details, toolSignal) => {
        manager.appendCustomEntry('pi-agenda-plan-message', { role: 'assistant', content: details.kind === 'review' ? `${details.title}\n\n${details.content}` : (details.questions ?? []).map(question => `${question.question}\n${question.options.map(option => `- ${option.label}${option.description ? `：${option.description}` : ''}`).join('\n')}`).join('\n\n') } satisfies ChatMessage)
        publish({ type: 'transcript', messages: this.transcript(manager) })
        const response = await this.interactions.ask(requestId, options.conversationId, details, toolSignal ?? signal, waitingFor('plan-interaction', details.kind === 'questions' ? '等待你回答问题…' : '等待你审阅计划…'))
        signal.throwIfAborted()
        interactionVersion++
        if (details.kind === 'questions') { clarified = true; session?.setActiveToolsByName(planningTools()) }
        manager.appendCustomEntry('pi-agenda-plan-message', { role: 'user', content: response.answers ? (details.questions ?? []).map(question => `${question.header || question.question}：${response.answers![question.id]}`).join('\n') : response.decision === 'approve' ? '批准计划并开始执行' : `修改计划：${response.feedback}` } satisfies ChatMessage)
        publish({ type: 'transcript', messages: this.transcript(manager) })
        return response
      },
      (title, content) => {
        signal.throwIfAborted()
        manager.appendCustomEntry('pi-agenda-approved-plan', { title, content, approvedAt: new Date().toISOString(), requestId })
        planning = false
        session?.setActiveToolsByName(projectTools.map(tool => tool.name))
        publish({ type: 'intent-mode', intentMode: 'execute' })
        status('计划已批准，正在执行…')
      }, () => planning, () => clarified) : []
    const tools = [...guardedTools, ...interactions]
    const previousEntries = new Set(manager.getEntries().map(entry => entry.id))
    let executionSaved = false
    const saveExecution = (): number => {
      const elapsedMs = Math.round(performance.now() - started)
      const entryIds = manager.getEntries().filter(entry => !previousEntries.has(entry.id) && entry.type === 'message' && entry.message.role === 'assistant').map(entry => entry.id)
      if (entryIds.length) manager.appendCustomEntry('pi-agenda-execution', { entryIds, execution: { model: profile.model, provider: profile.provider, elapsedMs, roundId: requestId } })
      executionSaved = true
      return elapsedMs
    }
    const roundUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    let unsubscribe: (() => void) | undefined
    let callStarted = performance.now()
    const abort = (): void => { status('正在停止任务…'); if (session) void session.abort() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      session = (await createAgentSession({ cwd, agentDir: path.join(this.dependencies.dataDirectory, 'agent-config'), modelRuntime: provider.runtime, model: provider.model, thinkingLevel: provider.thinkingLevel, sessionManager: manager, settingsManager, resourceLoader,
        tools: tools.map(tool => tool.name), customTools: tools })).session
      if (planning) session.setActiveToolsByName(planningTools())
      signal.throwIfAborted()
      unsubscribe = session.subscribe(event => {
        if (event.type === 'turn_start') { modelStatus = '正在连接模型…'; refreshStatus() }
        if (event.type === 'message_end' && event.message.role === 'assistant') {
          manager.appendCustomEntry('pi-agenda-call-duration', { messageTimestamp: event.message.timestamp, elapsedMs: Math.round(performance.now() - callStarted) })
          const usage = event.message.usage
          roundUsage.inputTokens += usage.input + usage.cacheRead + usage.cacheWrite
          roundUsage.outputTokens += usage.output
          roundUsage.cacheReadTokens += usage.cacheRead
          roundUsage.cacheWriteTokens += usage.cacheWrite
        }
        if (event.type === 'message_update') {
          const update = event.assistantMessageEvent
          if (update.type === 'text_start' || update.type === 'text_delta') modelStatus = '正在生成回复…'
          if (update.type === 'thinking_start' || update.type === 'thinking_delta') modelStatus = '正在思考…'
          if (update.type === 'toolcall_start' || update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
            const call = update.partial.content[update.contentIndex]
            modelStatus = call?.type === 'toolCall' && toolActions[call.name] ? `正在准备${toolActions[call.name]}...` : '正在准备工具调用…'
          }
          refreshStatus()
          if (update.type === 'text_delta') publish({ type: 'text', text: update.delta })
        }
        if (event.type === 'message_start' && event.message.role === 'assistant') { callStarted = performance.now(); modelStatus = '正在等待模型回复…'; status(modelStatus, true) }
        if (event.type === 'message_end' && ['user', 'assistant'].includes(event.message.role)) publish({ type: 'transcript', messages: this.transcript(manager) })
        if (event.type === 'tool_execution_start') { activeTools.set(event.toolCallId, event.toolName); refreshStatus() }
        if (event.type === 'tool_execution_end') {
          activeTools.delete(event.toolCallId)
          waitingTools.delete(event.toolCallId)
          modelStatus = event.isError ? `${toolActions[event.toolName] ?? '任务'}失败，正在处理...` : `已完成${toolActions[event.toolName] ?? '任务'}`
          refreshStatus()
          publish({ type: 'transcript', messages: this.transcript(manager) })
        }
        if (event.type === 'compaction_start') { modelStatus = '正在压缩上下文，完整记录仍保留…'; refreshStatus() }
        if (event.type === 'compaction_end') { modelStatus = event.errorMessage ? '上下文压缩失败，请检查模型服务' : '正在连接模型…'; refreshStatus() }
        if (event.type === 'auto_retry_start') { modelStatus = `模型请求失败，正在等待第 ${event.attempt} 次重试…`; refreshStatus() }
        if (event.type === 'auto_retry_end') { modelStatus = event.success ? '正在整理回复…' : '模型重试失败，正在处理…'; refreshStatus() }
        if (event.type === 'agent_end') { modelStatus = '正在整理回复…'; refreshStatus() }
      })
      const prepared = attachments.prepare(messages.at(-1)!)
      await session.prompt(prepared.text, { images: prepared.images, expandPromptTemplates: false })
      // 模型只输出正文会让 SDK 自然结束；由应用检查阶段，补充隐藏指令继续流程。
      // 每个有用户交互的阶段最多纠正两次，避免工具不兼容的模型无休止重试。
      let corrections = 0, lastInteractionVersion = interactionVersion
      while (planning) {
        signal.throwIfAborted()
        const last = session.messages.filter((message): message is AssistantMessage => message.role === 'assistant').at(-1)
        if (!last || last.stopReason === 'error' || last.stopReason === 'aborted') throw new ModelError('计划生成失败，请检查模型服务及工具调用能力后重试')
        if (last.stopReason === 'length') throw new ModelError('计划生成达到输出上限，尚未完成确认与审批，请提高输出 Token 上限后重试')
        if (interactionVersion !== lastInteractionVersion) { corrections = 0; lastInteractionVersion = interactionVersion }
        if (corrections++ >= 2) throw new ModelError(clarified ? '模型未提交可审批的计划，请使用支持工具调用的模型后重试' : '模型未发起需求确认，请使用支持工具调用的模型后重试')
        status(clarified ? '正在完善计划并准备审阅…' : '正在准备需求确认选项…')
        await session.sendCustomMessage({ customType: 'pi-agenda-plan-control', display: false, content: clarified
          ? '本轮仍处于计划模式，尚未获得用户批准。不要以普通文字结束；若还需要澄清请调用 ask_user_question，否则必须调用 submit_plan 将完整计划提交到审阅窗口。'
          : '本轮尚未进行需求确认。现在必须调用 ask_user_question，针对用户任务提出具体方案、范围或验收选项，等待本轮用户回答。不得直接提交计划，也不要仅用文字提问。' }, { triggerTurn: true })
      }
      signal.throwIfAborted()
      const final = session.messages.filter((message): message is AssistantMessage => message.role === 'assistant').at(-1)
      if (!final || final.stopReason === 'error' || final.stopReason === 'aborted') throw new ModelError(profile.provider === 'chatgpt' ? 'ChatGPT 订阅请求失败，请检查授权、模型权限与订阅额度后重试' : '模型请求失败，请检查接口、密钥和模型工具调用能力后重试')
      const text = session.getLastAssistantText() ?? ''
      if (!text.trim()) throw new ModelError('模型未返回正文，请提高输出 Token 上限后重试')
      const elapsedMs = saveExecution()
      return { text: apiKey ? text.split(apiKey).join('[已隐藏密钥]') : text, model: profile.model, elapsedMs, truncated: final.stopReason === 'length',
        usage: { inputTokens: final.usage.input + final.usage.cacheRead + final.usage.cacheWrite, outputTokens: final.usage.output }, roundUsage, rateLimits, messages: this.transcript(manager) }
    } finally {
      if (profile.provider === 'chatgpt') this.dependencies.chatgpt?.invalidateUsage()
      signal.removeEventListener('abort', abort)
      if (session) { await session.abort(); unsubscribe?.(); session.dispose() }
      if (!executionSaved) saveExecution()
      if (before && snapshot) {
        try {
          status('正在保存本轮改动…')
          after = await snapshot.createCheckpoint('代理修改后')
          const round = { project: snapshot.getRoot(), before, after, messageIndex: this.transcript(manager).length - 1 }
          manager.appendCustomEntry('pi-agenda-snapshot', round)
          publish({ type: 'snapshot', snapshot: round })
        } catch { status('修改后快照保存失败，请手动捕获当前改动') }
      }
      publish({ type: 'transcript', messages: this.transcript(manager) })
    }
  }
}
