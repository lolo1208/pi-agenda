import { useRef, useState } from 'react'
import type { ChatMessage, ModelProfileView } from '../../shared/models'
import { unwrapModelResult } from './model-result'
import { ChatComposer } from './components/chat/ChatComposer'
import { ChatTranscript } from './components/chat/ChatTranscript'

interface Props {
  profile: ModelProfileView | undefined; onBusyChange(busy: boolean): void; onOpenSettings(): void
  onMessagesChange?(messages: ChatMessage[]): void; settingsDisabled?: boolean; sendWithCtrlEnter?: boolean
}
export default function ModelChat({ profile, onBusyChange, onOpenSettings, onMessagesChange, settingsDisabled, sendWithCtrlEnter = true }: Props): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [pending, setPending] = useState('')
  const busyRef = useRef(false)
  const send = async (): Promise<void> => {
    if (!profile || busyRef.current || settingsDisabled || !prompt.trim()) return
    busyRef.current = true; onBusyChange(true); setError(''); setNotice(''); setPending(prompt.trim())
    const id = crypto.randomUUID(); setRequestId(id)
    const next: ChatMessage[] = [...messages, { role: 'user', content: prompt.trim() }]
    try {
      const reply = unwrapModelResult(await window.piConsole.chatWithModel(profile.id, id, next))
      const completed: ChatMessage[] = [...next, { role: 'assistant', content: reply.text }]
      setMessages(completed); onMessagesChange?.(completed); setPrompt('')
      setNotice(`${reply.model} · ${reply.elapsedMs} ms${reply.truncated ? ' · 已达到输出上限，可在设置中调整' : ''}`)
    } catch (e) { setError(e instanceof Error ? e.message : '模型请求失败，请重试') }
    finally { busyRef.current = false; setRequestId(null); setPending(''); onBusyChange(false) }
  }
  return <section className="model-chat" aria-label="模型对话">
    <ChatTranscript messages={messages} pendingMessage={pending} hasProfile={Boolean(profile)} settingsDisabled={settingsDisabled} onOpenSettings={onOpenSettings} />
    <div className="composer-wrap">
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="request-notice" role="status">{notice}</p>}
      <ChatComposer profile={profile} prompt={prompt} isBusy={Boolean(requestId)} hasMessages={messages.length > 0} settingsDisabled={settingsDisabled} sendWithCtrlEnter={sendWithCtrlEnter} onPromptChange={setPrompt} onOpenSettings={onOpenSettings} onSend={() => { void send() }} onCancel={() => { if (requestId) void window.piConsole.cancelModelRequest(requestId).then(unwrapModelResult).catch(() => setError('取消请求失败，请重试')) }} />
    </div>
  </section>
}



