import { useEffect, useRef, useState } from 'react'
import type { ChatgptUsage, ChatImage, ChatMessage, ModelProfileView, ModelProviderConnection, ModelReply } from '../../shared/models'
import { unwrapModelResult } from './model-result'
import { ChatComposer } from './components/chat/ChatComposer'
import { ChatTranscript } from './components/chat/ChatTranscript'
import { ComposerStatus } from './components/chat/ComposerStatus'
import { contextMessages, type ContextCompaction } from '../../shared/context'

interface Props {
  active?: boolean
  conversationId?: string
  initialMessages?: ChatMessage[]; initialDraft?: string; initialDraftImages?: ChatImage[]
  onDraftChange?(draft: string, images: ChatImage[]): void
  profiles?: ModelProfileView[]
  customPrompt?: string
  compressionThreshold?: number; initialCompaction?: ContextCompaction
  onCompactionChange?(compaction: ContextCompaction | undefined): void
  project?: string | null; providers?: ModelProviderConnection[]
  profile: ModelProfileView | undefined; onBusyChange(busy: boolean): void; onOpenSettings(): void
  onMessagesChange?(messages: ChatMessage[]): void; settingsDisabled?: boolean; sendWithCtrlEnter?: boolean
}
export default function ModelChat({ active = true, conversationId, initialMessages = [], initialDraft = '', initialDraftImages = [], initialCompaction, onCompactionChange, compressionThreshold = 90, onDraftChange, profile: defaultProfile, profiles, project, providers, onBusyChange, onOpenSettings, onMessagesChange, settingsDisabled, sendWithCtrlEnter = true, customPrompt = '' }: Props): React.JSX.Element {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(defaultProfile?.id ?? null)
  const availableProfiles = profiles ?? (defaultProfile ? [defaultProfile] : [])
  const usableProfiles = availableProfiles.filter(item => item.enabled !== false && item.available !== false)
  const profile = usableProfiles.find(item => item.id === selectedModelId)
    ?? usableProfiles.find(item => item.id === defaultProfile?.id) ?? usableProfiles[0]
  useEffect(() => {
    if (profile && profile.id !== selectedModelId) setSelectedModelId(profile.id)
  }, [profile?.id, selectedModelId])
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [compaction, setCompaction] = useState(initialCompaction)
  const [prompt, setPrompt] = useState(initialDraft)
  const [images, setImages] = useState<ChatImage[]>(initialDraftImages)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [pending, setPending] = useState<ChatMessage | null>(null)
  const [streamedText, setStreamedText] = useState('')
  const [agentStatus, setAgentStatus] = useState('')
  const activeRequest = useRef<string | null>(null)
  const nativeHistory = useRef(false)
  const messagesCallback = useRef(onMessagesChange)
  messagesCallback.current = onMessagesChange
  useEffect(() => {
    if (!conversationId || !window.piAgenda.getAgentHistory) return
    let active = true
    void window.piAgenda.getAgentHistory(conversationId).then(unwrapModelResult).then(history => {
      if (active && !busyRef.current && history) { nativeHistory.current = true; setMessages(history); messagesCallback.current?.(history) }
    }).catch(() => { if (active) setError('代理会话恢复失败，请检查本地会话文件后重试') })
    return () => { active = false }
  }, [conversationId])
  useEffect(() => window.piAgenda.onAgentEvent?.(event => {
    if (event.requestId !== activeRequest.current || event.conversationId !== conversationId) return
    if (event.type === 'text') setStreamedText(text => event.resetText ? event.text ?? '' : text + (event.text ?? ''))
    if (event.type === 'status') { setAgentStatus(event.text ?? ''); if (event.resetText) setStreamedText('') }
    if (event.type === 'transcript' && event.messages) {
      nativeHistory.current = true
      setMessages(event.messages); messagesCallback.current?.(event.messages); setPending(null); setStreamedText('')
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
  const send = async (): Promise<void> => {
    if (!profile || busyRef.current || settingsDisabled || (!prompt.trim() && !images.length)) return
    const message: ChatMessage = { role: 'user', content: prompt.trim(), ...(images.length ? { images } : {}) }
    busyRef.current = true; onBusyChange(true); setError(''); setNotice(''); setPending(message); setStreamedText(''); setAgentStatus('正在连接模型…')
    const id = crypto.randomUUID(); setRequestId(id); activeRequest.current = id
    const next: ChatMessage[] = [...messages, message]
    try {
      const instruction = customPrompt.trim()
      const requestContext = { threshold: compressionThreshold, usage: statistics?.profileId === profile.id ? statistics.reply.usage : undefined }
      const reply = unwrapModelResult(await (conversationId
        ? window.piAgenda.chatWithModel(profile.id, id, nativeHistory.current ? [message] : next, instruction || undefined, requestContext, { conversationId, project })
        : window.piAgenda.chatWithModel(profile.id, id, contextMessages(next, compaction), instruction || undefined, requestContext)))
      setStatistics({ profileId: profile.id, reply })
      if (reply.messages) nativeHistory.current = true
      const completed: ChatMessage[] = reply.messages ?? [...next, { role: 'assistant', content: reply.text }]
      setMessages(completed); onMessagesChange?.(completed); setPrompt(''); setImages([])
      if (reply.compaction) {
        const updated = { ...reply.compaction, coveredMessages: reply.compaction.coveredMessages + (compaction ? compaction.coveredMessages - 1 : 0) }
        setCompaction(updated); onCompactionChange?.(updated)
      } else if (conversationId) { setCompaction(undefined); onCompactionChange?.(undefined) }
      setNotice(`${reply.compaction ? '已自动压缩上下文，完整记录已保留 · ' : ''}${reply.model} · ${reply.elapsedMs} ms${reply.truncated ? ' · 已达到输出上限，可在设置中调整' : ''}`)
    } catch (e) { setError(e instanceof Error ? e.message : '模型请求失败，请重试') }
    finally { busyRef.current = false; activeRequest.current = null; setRequestId(null); setPending(null); setStreamedText(''); setAgentStatus(''); onBusyChange(false) }
  }
  return <section className="model-chat" aria-label="模型对话">
    <ChatTranscript messages={messages} pendingMessage={pending} streamedText={streamedText} agentStatus={agentStatus} isBusy={Boolean(requestId)} hasProfile={Boolean(profile)} settingsDisabled={settingsDisabled} onOpenSettings={onOpenSettings} />
    <div className="composer-wrap">
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="request-notice" role="status">{notice}</p>}
      <ChatComposer profile={profile} profiles={availableProfiles} onSelectModel={setSelectedModelId} prompt={prompt} images={images} onImagesChange={setImages} isBusy={Boolean(requestId)} hasMessages={messages.length > 0} settingsDisabled={settingsDisabled} sendWithCtrlEnter={sendWithCtrlEnter} onPromptChange={setPrompt} onOpenSettings={onOpenSettings} onSend={() => { void send() }} onCancel={() => { if (requestId) void window.piAgenda.cancelModelRequest(requestId).then(unwrapModelResult).catch(() => setError('取消请求失败，请重试')) }} />
      <ComposerStatus latestReply={matchingStatistics?.reply} subscriptionUsage={subscriptionUsage} compressionThreshold={compressionThreshold} project={project} profile={profile} contextLimit={providers?.find(item => item.provider === profile?.provider && item.baseUrl === profile?.baseUrl)?.models.find(item => item.id === profile?.model)?.maxContextTokens} messages={contextMessages(messages, compaction)} prompt={prompt} imageCount={images.length} attachments={images} usage={matchingStatistics?.reply.usage} rateLimits={matchingStatistics?.reply.rateLimits} onOpenProject={() => {
        if (project) void window.piAgenda.openProjectDirectory(project).catch(() => setError('无法打开项目目录，请检查目录是否存在后重试'))
      }} />
    </div>
  </section>
}
