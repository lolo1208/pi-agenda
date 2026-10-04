import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowUp, Settings2, Sparkles, Square } from 'lucide-react'
import type { ModelProfileView } from '../../../../shared/models'

interface ChatComposerProps {
  profile: ModelProfileView | undefined
  prompt: string
  isBusy: boolean
  hasMessages: boolean
  settingsDisabled?: boolean
  sendWithCtrlEnter: boolean
  onPromptChange: (prompt: string) => void
  onOpenSettings: () => void
  onSend: () => void
  onCancel: () => void
}

export function ChatComposer({ profile, prompt, isBusy, hasMessages, settingsDisabled, sendWithCtrlEnter, onPromptChange, onOpenSettings, onSend, onCancel }: ChatComposerProps): React.JSX.Element {
  const promptId = useId()
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Macintosh')
  const sendShortcut = isMac ? '⌘ + Enter' : 'Ctrl + Enter'

  return <form className="composer" onSubmit={event => { event.preventDefault(); onSend() }}>
    <Label className="sr-only" htmlFor={promptId}>消息</Label>
    <Textarea id={promptId} aria-label="消息" value={prompt} maxLength={32000} disabled={isBusy} placeholder={hasMessages ? '继续聊一聊…' : '描述你想完成的任务…'} onChange={event => onPromptChange(event.target.value)} onKeyDown={event => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
      const shouldSend = sendWithCtrlEnter ? (isMac ? event.metaKey : event.ctrlKey) : !event.shiftKey
      if (shouldSend) { event.preventDefault(); onSend() }
    }} />
    <div className="composer-actions">
      <span className="composer-mode"><Sparkles size={14} />文本对话</span>
      <div>
        <Button type="button" className="model-picker" disabled={isBusy || settingsDisabled} onClick={onOpenSettings} title="在设置中管理模型"><span>{profile?.model || '选择模型'}</span><Settings2 size={14} /></Button>
        {isBusy ? <Button type="button" className="send-button" aria-label="取消请求" onClick={onCancel}><Square size={14} /></Button> : <Button type="submit" className="send-button" aria-label="发送消息" title={`发送消息（${sendWithCtrlEnter ? sendShortcut : 'Enter'}）`} disabled={!profile || settingsDisabled || !prompt.trim()}><ArrowUp size={19} /></Button>}
      </div>
    </div>
  </form>
}
