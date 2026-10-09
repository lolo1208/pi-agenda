import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Settings2, Sparkles } from 'lucide-react'
import type { ChatMessage } from '../../../../shared/models'
import { ChatImages } from './ChatImages'

interface ChatTranscriptProps {
  messages: ChatMessage[]
  pendingMessage: ChatMessage | null
  hasProfile: boolean
  settingsDisabled?: boolean
  onOpenSettings: () => void
}

export function ChatTranscript({ messages, pendingMessage, hasProfile, settingsDisabled, onOpenSettings }: ChatTranscriptProps): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' })
  }, [messages, pendingMessage])

  return <div className="chat-scroll">
    {!messages.length && !pendingMessage && <div className="chat-welcome">
      <div className="welcome-brand">
        <div className="welcome-mark"><img src="./icons/app-icon.png" alt="" draggable={false} /></div>
        <span className="welcome-app-name">Pi Agenda · 行动派</span>
      </div>
      <h1>今天，想完成什么？</h1>
      <p>从一个想法、一个问题，或一项新任务开始。</p>
      {!hasProfile && <Button disabled={settingsDisabled} onClick={onOpenSettings}><Settings2 size={16} />配置模型</Button>}
    </div>}
    <div className="chat-messages" aria-live="polite">
      {messages.map((message, index) => <article className={`chat-message ${message.role}`} key={index}>
        {message.role === 'assistant' && <strong><Sparkles size={15} />Pi Agenda</strong>}
        {Boolean(message.images?.length) && <ChatImages images={message.images!} />}
        {message.content && <p>{message.content}</p>}
      </article>)}
      {pendingMessage && <>
        <article className="chat-message user">
          {Boolean(pendingMessage.images?.length) && <ChatImages images={pendingMessage.images!} />}
          {pendingMessage.content && <p>{pendingMessage.content}</p>}
        </article>
        <div className="thinking" role="status"><span className="busy-dot" />正在等待模型回复…</div>
      </>}
      <div ref={endRef} />
    </div>
  </div>
}
