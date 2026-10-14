import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatgptUsage, ChatImage, ChatMessage, ModelProfile, ModelProfileView, ModelProviderConnection, ModelReply, ModelSettings, ProviderId } from '../../shared/models'
import { unwrapModelResult } from './model-result'
import { ChatComposer } from './components/chat/ChatComposer'
import type { QueuedMessage } from './components/chat/MessageQueue'
import { ChatTranscript } from './components/chat/ChatTranscript'
import { ComposerStatus } from './components/chat/ComposerStatus'
import { contextMessages, type ContextCompaction } from '../../shared/context'
import type { PermissionMode, ToolApproval } from '../../shared/models'
import { ToolApprovalCard } from './components/chat/ToolApprovalCard'
import { ToolApprovalDiffDialog } from './components/chat/ToolApprovalDiffDialog'
import { FullAccessDialog } from './components/chat/FullAccessDialog'
import { SandboxSetupDialog } from './components/chat/SandboxSetupDialog'
import { SandboxStatus } from './components/chat/SandboxStatus'
import { mergeSandboxState, sameSandboxProject } from './lib/sandbox-state'
import type { SandboxState } from '../../shared/sandbox'
import { PlanDialog } from './components/chat/PlanDialog'
import { Button } from './components/ui/button'
import type { IntentMode, PlanInteraction } from '../../shared/models'
import { LoaderCircle } from 'lucide-react'

interface Props {
  snapshots?: import('../../shared/models').AgentSnapshot[]
  initialIntentMode?: IntentMode
  onIntentChange?(mode: IntentMode): void
  initialPermissionMode?: PermissionMode
  onPermissionChange?(mode: PermissionMode): void
  active?: boolean
  projectReady?: boolean
  conversationId?: string
  initialMessages?: ChatMessage[]; initialDraft?: string; initialDraftImages?: ChatImage[]
  onDraftChange?(draft: string, images: ChatImage[]): void
  profiles?: ModelProfileView[]
  customPrompt?: string
  compressionThreshold?: number; initialCompaction?: ContextCompaction
  onCompactionChange?(compaction: ContextCompaction | undefined): void
  /** 会话内已保存的模型；为空时回退到默认模型 */
  initialModelId?: string | null
  onModelChange?(modelId: string): void
  onReplyComplete?(): void
  onWaitingForInputChange?(waiting: boolean): void
  project?: string | null; providers?: ModelProviderConnection[]
  /** 快捷面板改完推理档位后回传新的模型设置，由顶层刷新。 */
  onModelSettingsChange?(settings: ModelSettings): void
  profile: ModelProfileView | undefined; onBusyChange(busy: boolean): void; onOpenSettings(): void
  onMessagesChange?(messages: ChatMessage[], restored?: boolean): void; settingsDisabled?: boolean; sendWithCtrlEnter?: boolean
}
export default function ModelChat({ snapshots, initialIntentMode = 'execute', onIntentChange, initialPermissionMode = 'default', onPermissionChange, active = true, projectReady = true, conversationId, initialMessages = [], initialDraft = '', initialDraftImages = [], initialCompaction, onCompactionChange, compressionThreshold = 90, onDraftChange, profile: defaultProfile, profiles, project, providers, onModelSettingsChange, onBusyChange, onReplyComplete, onWaitingForInputChange, onOpenSettings, onMessagesChange, initialModelId, onModelChange, settingsDisabled, sendWithCtrlEnter = true, customPrompt = '' }: Props): React.JSX.Element {
  const [permissionMode, setPermissionMode] = useState(initialPermissionMode)
  const [intentMode, setIntentMode] = useState<IntentMode>(initialIntentMode)
  const intentCallback = useRef(onIntentChange)
  intentCallback.current = onIntentChange
  const changeIntent = (mode: IntentMode): void => { setIntentMode(mode); intentCallback.current?.(mode) }
  const [interaction, setInteraction] = useState<PlanInteraction | null>(null)
  const [interactionOpen, setInteractionOpen] = useState(true)
  const [planProgress, setPlanProgress] = useState('')
  const [approvals, setApprovals] = useState<ToolApproval[]>([])
  const [approvalDetailsOpen, setApprovalDetailsOpen] = useState(false)
  const [permissionChanging, setPermissionChanging] = useState(false)
  const [fullConfirmation, setFullConfirmation] = useState<{ requestId: string; approval: ToolApproval } | null>(null)
  const waitingForInput = Boolean(interaction || approvals.length || fullConfirmation)
  const waitingCallback = useRef(onWaitingForInputChange)
  waitingCallback.current = onWaitingForInputChange
  useEffect(() => { waitingCallback.current?.(waitingForInput) }, [waitingForInput])
  useEffect(() => () => { waitingCallback.current?.(false) }, [])
  const [sandboxState, setSandboxState] = useState<SandboxState | null>(null)
  const currentSandboxState = project && sandboxState && sameSandboxProject(sandboxState.project, project) ? sandboxState : null
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [sandboxRefresh, setSandboxRefresh] = useState(0)
  const [pendingFullAccess, setPendingFullAccess] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(initialModelId ?? defaultProfile?.id ?? null)
  /**
   * 默认模型仅作为初始值：后续默认设置变化不影响已打开的会话。
   * 用户在会话内选择的模型通过 onModelChange 持久化到会话数据。
   */
  const defaultModelId = useRef(defaultProfile?.id ?? null)
  const availableProfiles = profiles ?? (defaultProfile ? [defaultProfile] : [])
  const usableProfiles = availableProfiles.filter(item => item.enabled !== false && item.available !== false)
  const profile = usableProfiles.find(item => item.id === selectedModelId)
    ?? usableProfiles.find(item => item.id === (selectedModelId ? defaultModelId.current : selectedModelId)) ?? usableProfiles[0]
  useEffect(() => {
    if (profile && profile.id !== selectedModelId) setSelectedModelId(profile.id)
  }, [profile?.id, selectedModelId])
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [scrollToLatestRequest, setScrollToLatestRequest] = useState(0)
  const [compaction, setCompaction] = useState(initialCompaction)
  const [prompt, setPrompt] = useState(initialDraft)
  const [images, setImages] = useState<ChatImage[]>(initialDraftImages)
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [queuePaused, setQueuePaused] = useState(false)
  const savedDraft = useRef<{ prompt: string; images: ChatImage[] } | null>(null)
  const restoreDraft = (): void => {
    setPrompt(savedDraft.current?.prompt ?? ''); setImages(savedDraft.current?.images ?? [])
    savedDraft.current = null; setEditingId(null)
  }
  const editQueued = (id: string): void => {
    const item = queue.find(item => item.id === id)
    if (!item) return
    if (editingId) return
    savedDraft.current = { prompt, images }
    setEditingId(id); setPrompt(item.content); setImages(item.images ?? [])
  }
  const deleteQueued = (id: string): void => {
    setQueue(items => items.filter(item => item.id !== id))
    if (editingId === id) restoreDraft()
    if (queue.length === 1) setQueuePaused(false)
  }
  const reorderQueued = (id: string, targetId: string): void => {
    setQueue(items => {
      const from = items.findIndex(item => item.id === id), to = items.findIndex(item => item.id === targetId)
      if (from < 0 || to < 0 || from === to) return items
      const next = [...items]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
  }
  const submit = (): void => {
    if (!profile || permissionChanging || settingsDisabled || !projectReady || (!prompt.trim() && !images.length)) return
    if (editingId) {
      setQueue(items => items.map(item => item.id === editingId ? { ...item, content: prompt.trim(), images } : item))
      restoreDraft()
    } else {
      setQueue(items => [...items, { id: crypto.randomUUID(), role: 'user', content: prompt.trim(), ...(images.length ? { images } : {}) }])
      setPrompt(''); setImages([])
    }
  }
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const changePermission = useCallback(async (mode: PermissionMode): Promise<void> => {
    if (!conversationId) return
    setPermissionChanging(true)
    try {
      const selected = unwrapModelResult(await window.piAgenda.setPermissionMode(conversationId, mode))
      setPermissionMode(selected); onPermissionChange?.(selected)
    } catch (e) { setError(e instanceof Error ? e.message : '权限切换失败，请重试') }
    finally { setPermissionChanging(false) }
  }, [conversationId, onPermissionChange])
  /** 快捷面板内的推理修改：按设置页的字段归一规则只重写推理相关字段，其余参数原样保存。 */
  const changeThinking = useCallback(async (target: ModelProfileView, value: boolean | string | null): Promise<void> => {
    if (target.provider !== 'chatgpt' && target.provider !== 'ollama') return
    const { hasApiKey: _hasApiKey, available: _available, ...base } = target
    const next: ModelProfile = { ...base,
      thinkingLevel: target.provider === 'chatgpt' && typeof value === 'string' ? value as ModelProfile['thinkingLevel'] : null,
      ollamaThinkingLevel: target.provider === 'ollama' && typeof value === 'string' ? value : null,
      thinking: typeof value === 'boolean' ? value : null }
    try {
      const settings = unwrapModelResult(await window.piAgenda.saveModelProfile({ profile: next, credential: { action: 'keep' } }))
      onModelSettingsChange?.(settings)
    } catch (e) { setError(e instanceof Error ? e.message : '推理强度保存失败，请重试') }
  }, [onModelSettingsChange])
  useEffect(() => {
    if (!pendingFullAccess || requestId) return
    setPendingFullAccess(false); setSandboxOpen(false)
    void changePermission('full')
  }, [pendingFullAccess, requestId, changePermission])
  useEffect(() => {
    if (!project || !window.piAgenda.getSandboxStatus) { setSandboxState(null); return }
    if (!projectReady) return
    let current = true
    const automatic = permissionMode === 'auto' && active && Boolean(window.piAgenda.ensureSandbox)
    let timer: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    const failed = (e: unknown): void => {
      if (!current) return
      const message = e instanceof Error ? e.message : '无法准备安全执行环境，请手动检查'
      if (permissionMode === 'auto') setSandboxState({ project, phase: 'failed', operationId: '', steps: [], message, updatedAt: Date.now() })
      else setError(message)
    }
    const read = (): void => {
      let finished = false
      watchdog = setTimeout(() => { finished = true; failed(new Error('安全执行状态查询超时，请手动检查当前项目和后台服务')) }, 30000)
      const request = automatic ? window.piAgenda.ensureSandbox : window.piAgenda.getSandboxStatus
      void request().then(unwrapModelResult).then(state => {
        if (!current || finished) return
        const matching = sameSandboxProject(state.project, project)
        if (matching) setSandboxState(previous => mergeSandboxState(previous, state))
        if (automatic && (!matching || state.phase === 'unconfigured' || state.phase === 'running')) {
          if ((!matching || state.phase === 'unconfigured') && Date.now() - started >= 30000) failed(new Error('安全执行准备未能启动，请检查当前项目是否已打开、其他任务是否已结束'))
          else timer = setTimeout(read, 2000)
        }
      }).catch(e => { if (!finished) failed(e) }).finally(() => { if (watchdog) clearTimeout(watchdog) })
    }
    read()
    return () => { current = false; if (timer) clearTimeout(timer); if (watchdog) clearTimeout(watchdog) }
  }, [project, permissionMode, active, projectReady, requestId, sandboxRefresh])
  useEffect(() => window.piAgenda.onSandboxState?.(state => {
    if (!project || !sameSandboxProject(state.project, project)) return
    setSandboxState(previous => mergeSandboxState(previous, state))
  }), [project, active, permissionMode])
  const getApprovalPreview = useCallback(async (approval: ToolApproval) => {
    if (!requestId || !conversationId) throw new Error('审批请求已失效')
    return unwrapModelResult(await window.piAgenda.getToolApprovalPreview(requestId, conversationId, approval.id))
  }, [requestId, conversationId])
  const [pending, setPending] = useState<{ message: ChatMessage; firstMessage: number } | null>(null)
  const [streamedText, setStreamedText] = useState('')
  const [agentStatus, setAgentStatus] = useState('')
  const [execution, setExecution] = useState<{ model: string; provider: ProviderId; startedAt: number; firstMessage: number }>()
  const activeRequest = useRef<string | null>(null)
  const nativeHistory = useRef(false)
  const messagesCallback = useRef(onMessagesChange)
  messagesCallback.current = onMessagesChange
  // 请求期间可以切换会话，完成时必须使用当前的查看状态。
  const replyCompleteCallback = useRef(onReplyComplete)
  replyCompleteCallback.current = onReplyComplete
  useEffect(() => {
    if (!conversationId || !window.piAgenda.getAgentHistory) return
    let active = true
    void window.piAgenda.getAgentHistory(conversationId).then(unwrapModelResult).then(history => {
      if (active && !busyRef.current && history) { nativeHistory.current = true; setMessages(history); messagesCallback.current?.(history, true) }
    }).catch(() => { if (active) setError('代理会话恢复失败，请检查本地会话文件后重试') })
    return () => { active = false }
  }, [conversationId])
  useEffect(() => window.piAgenda.onAgentEvent?.(event => {
    if (event.conversationId !== conversationId) return
    if (event.type === 'approval' && event.approval?.tool === 'full-access') { setFullConfirmation({ requestId: event.requestId, approval: event.approval }); return }
    if (event.type === 'approval-end') setFullConfirmation(previous => previous?.approval.id === event.approvalId ? null : previous)
    if (event.requestId !== activeRequest.current) return
    if (event.type === 'plan-interaction' && event.interaction) { setPlanProgress(''); setInteraction(event.interaction); setInteractionOpen(true) }
    if (event.type === 'plan-interaction-end') setInteraction(previous => previous?.id === event.interactionId ? null : previous)
    if (event.type === 'intent-mode' && event.intentMode) { setPlanProgress(''); changeIntent(event.intentMode) }
    if (event.type === 'approval' && event.approval) { const approval = event.approval; setApprovals(items => [...items.filter(item => item.id !== approval.id), approval]) }
    if (event.type === 'approval-end') setApprovals(items => items.filter(item => item.id !== event.approvalId))
    if (event.type === 'text') setStreamedText(text => event.resetText ? event.text ?? '' : text + (event.text ?? ''))
    if (event.type === 'status') { setAgentStatus(event.text ?? ''); if (event.resetText) setStreamedText('') }
    if (event.type === 'transcript' && event.messages) {
      nativeHistory.current = true
      setMessages(event.messages); messagesCallback.current?.(event.messages)
      // SDK 的同步事件可能早于用户消息写入；确认本轮消息已入历史后才移除临时气泡。
      const history = event.messages
      setPending(previous => previous && history.slice(previous.firstMessage).some(message =>
        message.role === 'user' && message.content === previous.message.content
        && (message.images?.length ?? 0) === (previous.message.images?.length ?? 0)
        && (message.images ?? []).every((image, index) => image.id === previous.message.images?.[index].id)
      ) ? null : previous)
      setStreamedText('')
    }
  }), [conversationId])
  const [statistics, setStatistics] = useState<{ profileId: string; reply: ModelReply } | null>(null)
  const matchingStatistics = statistics && statistics.profileId === profile?.id ? statistics : null
  const [subscriptionUsage, setSubscriptionUsage] = useState<ChatgptUsage>()
  useEffect(() => {
    if (!active || profile?.provider !== 'chatgpt') return
    let disposed = false
    const refresh = (): void => {
      void window.piAgenda.getChatgptUsage().then(unwrapModelResult).then(value => { if (!disposed) setSubscriptionUsage(value) }).catch(e => {
        if (!disposed) setSubscriptionUsage(previous => { const error = e instanceof Error ? e.message : '订阅额度读取失败，将自动重试'; return { windows: /授权|登录|切换/.test(error) ? [] : previous?.windows ?? [], fetchedAt: previous?.fetchedAt ?? 0, error } })
      })
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [active, profile?.provider, requestId])
  const busyRef = useRef(false)
  const draftCallback = useRef(onDraftChange)
  draftCallback.current = onDraftChange
  useEffect(() => { draftCallback.current?.(prompt, images) }, [prompt, images])
  const send = async (item: QueuedMessage): Promise<void> => {
    if (!profile || busyRef.current) return
    const { id: _queueId, ...message } = item
    setQueue(items => items.filter(queued => queued.id !== item.id))
    setScrollToLatestRequest(value => value + 1)
    busyRef.current = true; onBusyChange(true); setError(''); setNotice(''); setPending({ message, firstMessage: messages.length }); setStreamedText(''); setAgentStatus('正在连接模型…')
    const id = crypto.randomUUID(); setRequestId(id); activeRequest.current = id
    setExecution({ model: profile.model, provider: profile.provider, startedAt: performance.now(), firstMessage: messages.length })
    const next: ChatMessage[] = [...messages, message]
    try {
      const instruction = customPrompt.trim()
      const requestContext = { threshold: compressionThreshold, usage: statistics?.profileId === profile.id ? statistics.reply.usage : undefined }
      const requestMessages = (conversationId ? nativeHistory.current ? [message] : next : contextMessages(next, compaction))
        .map(({ execution: _execution, snapshotHash: _snapshotHash, ...message }) => message)
      const reply = unwrapModelResult(await (conversationId
        ? window.piAgenda.chatWithModel(profile.id, id, requestMessages, instruction || undefined, requestContext, { conversationId, project, ...(intentMode !== 'execute' ? { intentMode } : {}) })
        : window.piAgenda.chatWithModel(profile.id, id, requestMessages, instruction || undefined, requestContext)))
      setStatistics({ profileId: profile.id, reply })
      if (reply.messages) nativeHistory.current = true
      const completed: ChatMessage[] = (reply.messages ?? [...next, { role: 'assistant' as const, content: reply.text }]).map((message, index) =>
        message.role === 'assistant' && index >= messages.length && message.execution?.elapsedMs === undefined ? { ...message, execution: { model: reply.model, provider: profile.provider, elapsedMs: reply.elapsedMs } } : message)
      setMessages(completed); onMessagesChange?.(completed)
      replyCompleteCallback.current?.()
      if (reply.compaction) {
        const updated = { ...reply.compaction, coveredMessages: reply.compaction.coveredMessages + (compaction ? compaction.coveredMessages - 1 : 0) }
        setCompaction(updated); onCompactionChange?.(updated)
      } else if (conversationId) { setCompaction(undefined); onCompactionChange?.(undefined) }
      setNotice([reply.compaction ? '已自动压缩上下文，完整记录已保留' : '', reply.truncated ? '已达到输出上限，可在设置中调整' : ''].filter(Boolean).join(' · '))
    } catch (e) {
      setError(e instanceof Error ? e.message : '模型请求失败，请重试')
      setQueue(items => [item, ...items]); setQueuePaused(true)
    }
    finally { busyRef.current = false; activeRequest.current = null; setRequestId(null); setPending(null); setStreamedText(''); setAgentStatus(''); setApprovals([]); setFullConfirmation(null); setInteraction(null); setPlanProgress(''); onBusyChange(false) }
  }
  // 等历史更新后再执行下一条，确保下一轮使用完整上下文。编辑时暂缓队列执行。
  useEffect(() => {
    if (requestId || busyRef.current || editingId || queuePaused || permissionChanging || settingsDisabled || !projectReady || pendingFullAccess || !profile || !queue.length) return
    void send(queue[0])
  })
  return <section className="model-chat" aria-label="模型对话">
    {active && sandboxState && <SandboxSetupDialog open={sandboxOpen} state={sandboxState} taskRunning={Boolean(requestId)} onClose={() => setSandboxOpen(false)} onRun={async action => {
      const state = unwrapModelResult(await window.piAgenda.startSandbox(action))
      setSandboxState(current => mergeSandboxState(current, state))
      setSandboxRefresh(value => value + 1)
    }} onStop={async () => { unwrapModelResult(await window.piAgenda.stopSandbox()) }} onFullAccess={() => {
      if (!requestId) { setSandboxOpen(false); void changePermission('full'); return }
      void window.piAgenda.cancelModelRequest(requestId).then(unwrapModelResult).then(() => setPendingFullAccess(true)).catch(e => setError(e instanceof Error ? e.message : '停止任务失败，请重试'))
    }} />}
    {active && interaction && interactionOpen && <PlanDialog key={interaction.id} interaction={interaction} onDismiss={() => setInteractionOpen(false)} onCancel={() => {
      if (requestId) void window.piAgenda.cancelModelRequest(requestId).then(unwrapModelResult).catch(() => setError('取消计划失败，请重试'))
    }} onRespond={async response => {
      if (!requestId || !conversationId) throw new Error('计划交互已失效')
      const progress = response.answers ? '已提交回答，正在与模型沟通…' : response.decision === 'revise' ? '已提交修改意见，正在完善计划…' : ''
      setPlanProgress(progress)
      try {
        unwrapModelResult(await window.piAgenda.respondPlanInteraction(requestId, conversationId, interaction.id, response))
      } catch (e) { setPlanProgress(''); throw e }
    }} />}
    {fullConfirmation && conversationId && <FullAccessDialog key={fullConfirmation.approval.id} onRespond={async allow => {
      try { unwrapModelResult(await window.piAgenda.respondToolApproval(fullConfirmation.requestId, conversationId, fullConfirmation.approval.id, allow)) }
      catch (e) { setError(e instanceof Error ? e.message : '权限确认失败，请重试') }
    }} />}
    <ChatTranscript active={active} scrollToLatestRequest={scrollToLatestRequest} snapshots={snapshots} messages={messages} pendingMessage={pending?.message ?? null} streamedText={streamedText} agentStatus={agentStatus} isBusy={Boolean(requestId)} execution={execution} hasProfile={Boolean(profile)} settingsDisabled={settingsDisabled} onOpenSettings={onOpenSettings} />
    <div className="composer-wrap">
      {requestId && !interaction && planProgress && <div className="plan-waiting plan-progress" role="status"><LoaderCircle size={18} className="plan-progress-spinner" aria-hidden="true" /><span>{planProgress}</span></div>}
      {interaction && <div className="plan-waiting"><span>{interaction.kind === 'questions' ? '计划正在等待你的回答' : '计划已准备好，等待你的批准'}</span><Button variant="outline" onClick={() => setInteractionOpen(true)}>{interaction.kind === 'questions' ? '回答问题' : '审阅计划'}</Button></div>}
      {approvals.map(approval => <ToolApprovalCard key={approval.id} approval={approval} onViewDetails={() => setApprovalDetailsOpen(true)} onRespond={async allow => {
        if (!requestId || !conversationId) return
        try { unwrapModelResult(await window.piAgenda.respondToolApproval(requestId, conversationId, approval.id, allow)) }
        catch (e) { setError(e instanceof Error ? e.message : '审批回应失败，请重试') }
      }} />)}
      <ToolApprovalDiffDialog open={approvalDetailsOpen} onOpenChange={setApprovalDetailsOpen} approvals={approvals} getPreview={getApprovalPreview} />
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="request-notice" role="status">{notice}</p>}
      {active && project && <SandboxStatus key={project} visible={permissionMode === 'auto'} state={currentSandboxState} onInspect={() => setSandboxOpen(true)} />}
      <ChatComposer queue={queue} editingId={editingId} queuePaused={queuePaused} onResumeQueue={() => setQueuePaused(false)} onCancelEdit={restoreDraft} onEditQueued={editQueued} onDeleteQueued={deleteQueued} onReorderQueued={reorderQueued} intentMode={intentMode} onIntentChange={changeIntent} permissionMode={permissionMode} onPermissionChange={conversationId ? changePermission : undefined} profile={profile} profiles={availableProfiles} providers={providers} onSelectModel={id => { setSelectedModelId(id); onModelChange?.(id) }} onThinkingChange={changeThinking} prompt={prompt} images={images} onImagesChange={setImages} isBusy={Boolean(requestId)} hasMessages={messages.length > 0} settingsDisabled={settingsDisabled || permissionChanging || !projectReady} sendWithCtrlEnter={sendWithCtrlEnter} onPromptChange={setPrompt} onOpenSettings={onOpenSettings} onSend={submit} onCancel={() => { if (requestId) void window.piAgenda.cancelModelRequest(requestId).then(unwrapModelResult).catch(() => setError('取消请求失败，请重试')) }} />
      <ComposerStatus latestReply={matchingStatistics?.reply} subscriptionUsage={subscriptionUsage} compressionThreshold={compressionThreshold} project={project} profile={profile} contextLimit={providers?.find(item => item.provider === profile?.provider && item.baseUrl === profile?.baseUrl)?.models.find(item => item.id === profile?.model)?.maxContextTokens} messages={contextMessages(messages, compaction)} prompt={prompt} imageCount={images.length} attachments={images} usage={matchingStatistics?.reply.usage} rateLimits={matchingStatistics?.reply.rateLimits} onOpenProject={() => {
        if (project) void window.piAgenda.openProjectDirectory(project).catch(() => setError('无法打开项目目录，请检查目录是否存在后重试'))
      }} />
    </div>
  </section>
}
