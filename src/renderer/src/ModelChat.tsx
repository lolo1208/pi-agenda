import { useEffect, useRef, useState } from 'react'
import type { ChatImage, ChatMessage, ModelProfileView, ModelProviderConnection, ModelReply } from '../../shared/models'
import { unwrapModelResult } from './model-result'
import { ChatComposer } from './components/chat/ChatComposer'
import { ChatTranscript } from './components/chat/ChatTranscript'
import { ComposerStatus } from './components/chat/ComposerStatus'

interface Props {
  initialMessages?: ChatMessage[]; initialDraft?: string; initialDraftImages?: ChatImage[]
  onDraftChange?(draft: string, images: ChatImage[]): void
  profiles?: ModelProfileView[]
  customPrompt?: string
  project?: string | null; providers?: ModelProviderConnection[]
  profile: ModelProfileView | undefined; onBusyChange(busy: boolean): void; onOpenSettings(): void
  onMessagesChange?(messages: ChatMessage[]): void; settingsDisabled?: boolean; sendWithCtrlEnter?: boolean
}
export default function ModelChat({ initialMessages = [], initialDraft = '', initialDraftImages = [], onDraftChange, profile: defaultProfile, profiles, project, providers, onBusyChange, onOpenSettings, onMessagesChange, settingsDisabled, sendWithCtrlEnter = true, customPrompt = '' }: Props): React.JSX.Element {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(defaultProfile?.id ?? null)
  const availableProfiles = profiles ?? (defaultProfile ? [defaultProfile] : [])
  const usableProfiles = availableProfiles.filter(item => item.enabled !== false && item.available !== false)
  const profile = usableProfiles.find(item => item.id === selectedModelId)
    ?? usableProfiles.find(item => item.id === defaultProfile?.id) ?? usableProfiles[0]
  useEffect(() => {
    if (profile && profile.id !== selectedModelId) setSelectedModelId(profile.id)
  }, [profile?.id, selectedModelId])
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [prompt, setPrompt] = useState(initialDraft)
  const [images, setImages] = useState<ChatImage[]>(initialDraftImages)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [pending, setPending] = useState<ChatMessage | null>(null)
  const [statistics, setStatistics] = useState<{ profileId: string; reply: ModelReply } | null>(null)
  const busyRef = useRef(false)
  const draftCallback = useRef(onDraftChange)
  draftCallback.current = onDraftChange
  useEffect(() => { draftCallback.current?.(prompt, images) }, [prompt, images])
  const send = async (): Promise<void> => {
    if (!profile || busyRef.current || settingsDisabled || (!prompt.trim() && !images.length)) return
    const message: ChatMessage = { role: 'user', content: prompt.trim(), ...(images.length ? { images } : {}) }
    busyRef.current = true; onBusyChange(true); setError(''); setNotice(''); setPending(message)
    const id = crypto.randomUUID(); setRequestId(id)
    const next: ChatMessage[] = [...messages, message]
    try {
      const instruction = customPrompt.trim()
      const reply = unwrapModelResult(await (instruction
        ? window.piAgenda.chatWithModel(profile.id, id, next, instruction)
        : window.piAgenda.chatWithModel(profile.id, id, next)))
      setStatistics({ profileId: profile.id, reply })
      const completed: ChatMessage[] = [...next, { role: 'assistant', content: reply.text }]
      setMessages(completed); onMessagesChange?.(completed); setPrompt(''); setImages([])
      setNotice(`${reply.model} · ${reply.elapsedMs} ms${reply.truncated ? ' · 已达到输出上限，可在设置中调整' : ''}`)
    } catch (e) { setError(e instanceof Error ? e.message : '模型请求失败，请重试') }
    finally { busyRef.current = false; setRequestId(null); setPending(null); onBusyChange(false) }
  }
  return <section className="model-chat" aria-label="模型对话">
    <ChatTranscript messages={messages} pendingMessage={pending} hasProfile={Boolean(profile)} settingsDisabled={settingsDisabled} onOpenSettings={onOpenSettings} />
    <div className="composer-wrap">
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="request-notice" role="status">{notice}</p>}
      <ChatComposer profile={profile} profiles={availableProfiles} onSelectModel={setSelectedModelId} prompt={prompt} images={images} onImagesChange={setImages} isBusy={Boolean(requestId)} hasMessages={messages.length > 0} settingsDisabled={settingsDisabled} sendWithCtrlEnter={sendWithCtrlEnter} onPromptChange={setPrompt} onOpenSettings={onOpenSettings} onSend={() => { void send() }} onCancel={() => { if (requestId) void window.piAgenda.cancelModelRequest(requestId).then(unwrapModelResult).catch(() => setError('取消请求失败，请重试')) }} />
      <ComposerStatus project={project} profile={profile} contextLimit={providers?.find(item => item.provider === profile?.provider)?.models.find(item => item.id === profile?.model)?.maxContextTokens} messages={messages} prompt={prompt} imageCount={images.length} usage={statistics?.profileId === profile?.id ? statistics?.reply.usage : undefined} rateLimits={statistics?.profileId === profile?.id ? statistics?.reply.rateLimits : undefined} onOpenProject={() => {
        if (project) void window.piAgenda.openProjectDirectory(project).catch(() => setError('无法打开项目目录，请检查目录是否存在后重试'))
      }} />
    </div>
  </section>
}
