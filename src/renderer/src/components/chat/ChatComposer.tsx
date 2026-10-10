import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowUp, Plus, Sparkles, Square } from 'lucide-react'
import { MAX_ATTACHMENT_BYTES, MAX_MESSAGE_ATTACHMENTS, type ChatImage, type ModelProfileView } from '../../../../shared/models'
import { attachmentMime } from '../../../../shared/attachments'
import { ChatImages } from './ChatImages'
import { ConversationModelPicker } from './ConversationModelPicker'

interface ChatComposerProps {
  profile: ModelProfileView | undefined
  profiles?: ModelProfileView[]
  onSelectModel?: (id: string) => void
  prompt: string
  images: ChatImage[]
  isBusy: boolean
  hasMessages: boolean
  settingsDisabled?: boolean
  sendWithCtrlEnter: boolean
  onPromptChange: (prompt: string) => void
  onImagesChange: (images: ChatImage[]) => void
  onOpenSettings: () => void
  onSend: () => void
  onCancel: () => void
}

export function ChatComposer({ profile, profiles, onSelectModel, prompt, images, isBusy, hasMessages, settingsDisabled, sendWithCtrlEnter, onPromptChange, onImagesChange, onOpenSettings, onSend, onCancel }: ChatComposerProps): React.JSX.Element {
  const promptId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const readingRef = useRef(false)
  const [reading, setReading] = useState(false)
  const [imageError, setImageError] = useState('')
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Macintosh')
  const sendShortcut = isMac ? '⌘ + Enter' : 'Ctrl + Enter'

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const resize = () => {
      if (!textarea.clientWidth) return
      const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 25.2
      textarea.style.height = '0px'
      const height = Math.max(lineHeight, textarea.scrollHeight)
      textarea.style.height = `${Math.min(height, lineHeight * 8)}px`
      textarea.style.overflowY = height > lineHeight * 8 ? 'auto' : 'hidden'
    }
    resize()
    let width = textarea.clientWidth
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (textarea.clientWidth !== width) { width = textarea.clientWidth; resize() }
    })
    observer?.observe(textarea)
    return () => observer?.disconnect()
  }, [prompt, images.length])

  const addImages = async (files: File[]): Promise<void> => {
    if (isBusy || readingRef.current || !files.length) return
    setImageError('')
    if (images.length + files.length > MAX_MESSAGE_ATTACHMENTS) { setImageError(`最多添加 ${MAX_MESSAGE_ATTACHMENTS} 个附件。`); return }
    if (files.some(file => file.size > MAX_ATTACHMENT_BYTES)) { setImageError('每个附件不能超过 32 MiB。'); return }
    readingRef.current = true; setReading(true)
    try {
      const added = await Promise.all(files.map(file => new Promise<ChatImage>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const data = String(reader.result).split(',')[1] ?? ''
          const mime = attachmentMime(file.name, file.type)
          resolve({ id: crypto.randomUUID(), name: file.name.slice(0, 255) || '粘贴的附件', dataUrl: `data:${mime};base64,${data}` })
        }
        reader.onerror = () => reject(new Error('附件读取失败，请重试。'))
        reader.onabort = () => reject(new Error('附件读取已取消，请重试。'))
        reader.readAsDataURL(file)
      })))
      onImagesChange([...images, ...added])
    } catch (error) { setImageError(error instanceof Error ? error.message : '附件读取失败，请重试。') }
    finally { readingRef.current = false; setReading(false) }
  }

  return <form className="composer" onSubmit={event => { event.preventDefault(); if (!readingRef.current) onSend() }} onDragOver={event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }} onDrop={event => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault(); void addImages(Array.from(event.dataTransfer.files))
  }}>
    {images.length > 0 && <ChatImages images={images} disabled={isBusy || reading} onRemove={id => onImagesChange(images.filter(image => image.id !== id))} />}
    {imageError && <p className="composer-image-error" role="alert">{imageError}</p>}
    <input ref={fileRef} type="file" multiple hidden aria-label="选择文件附件" onChange={event => {
      void addImages(Array.from(event.target.files ?? [])); event.target.value = ''
    }} />
    <Label className="sr-only" htmlFor={promptId}>消息</Label>
    <Textarea ref={textareaRef} rows={1} id={promptId} aria-label="消息" value={prompt} maxLength={32000} disabled={isBusy} placeholder={hasMessages ? '继续聊一聊…' : '描述你想完成的任务…'} onChange={event => onPromptChange(event.target.value)} onPaste={event => {
      const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => Boolean(file))
      if (files.length) { event.preventDefault(); void addImages(files) }
    }} onKeyDown={event => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
      const shouldSend = sendWithCtrlEnter ? (isMac ? event.metaKey : event.ctrlKey) : !event.shiftKey
      if (shouldSend) { event.preventDefault(); if (!readingRef.current) onSend() }
    }} />
    <div className="composer-actions">
      <div className="composer-tools">
        <Button type="button" className="attach-image-button" aria-label="添加附件" title="添加文件，也可粘贴或拖入" disabled={isBusy || reading || images.length >= MAX_MESSAGE_ATTACHMENTS} onClick={() => fileRef.current?.click()}><Plus size={17} /></Button>
        <span className="composer-mode"><Sparkles size={14} />{reading ? '正在添加附件…' : '对话'}</span>
      </div>
      <div>
        <ConversationModelPicker profile={profile} profiles={profiles ?? (profile ? [profile] : [])} disabled={isBusy || settingsDisabled} onSelect={onSelectModel ?? (() => undefined)} onOpenSettings={onOpenSettings} />
        {isBusy ? <Button type="button" className="send-button" aria-label="取消请求" onClick={onCancel}><Square size={14} /></Button> : <Button type="submit" className="send-button" aria-label="发送消息" title={`发送消息（${sendWithCtrlEnter ? sendShortcut : 'Enter'}）`} disabled={!profile || settingsDisabled || reading || (!prompt.trim() && !images.length)}><ArrowUp size={19} /></Button>}
      </div>
    </div>
  </form>
}
