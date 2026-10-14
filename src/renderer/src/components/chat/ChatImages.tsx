import { useState } from 'react'
import { File, FileText, Music, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { ChatImage } from '../../../../shared/models'
import { attachmentKind, attachmentSize, attachmentText, formatAttachmentSize } from '../../../../shared/attachments'

interface Props { images: ChatImage[]; onRemove?: (id: string) => void; disabled?: boolean }

export function ChatImages({ images, onRemove, disabled }: Props): React.JSX.Element {
  const [preview, setPreview] = useState<ChatImage | null>(null)
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set())
  const kind = preview ? attachmentKind(preview) : null
  const markUnreadable = (id: string): void => setUnreadable(items => new Set([...items, id]))
  return <>
    <div className="chat-images" aria-label="文件附件">
      {images.map(image => {
        const fileKind = attachmentKind(image)
        const mime = image.dataUrl.slice(5, image.dataUrl.indexOf(';'))
        const canPreview = !unreadable.has(image.id) && (fileKind === 'image' || fileKind === 'text' || ((fileKind === 'audio' || fileKind === 'video') && Boolean(document.createElement(fileKind).canPlayType(mime))))
        const Icon = fileKind === 'text' ? FileText : fileKind === 'audio' ? Music : fileKind === 'video' ? Video : File
        const label = fileKind === 'image' ? '图片' : '附件'
        const contents = fileKind === 'image' && !unreadable.has(image.id)
          ? <img src={image.dataUrl} alt={image.name} onError={() => markUnreadable(image.id)} />
          : <><Icon size={20} aria-hidden="true" /><span className="chat-file-info"><span>{image.name}</span><small>{formatAttachmentSize(attachmentSize(image))}{!canPreview ? ' · 无法预览' : ''}</small></span></>
        return <div className={`chat-image${fileKind !== 'image' || unreadable.has(image.id) ? ' chat-file' : ''}`} key={image.id}>
          {canPreview ? <Button type="button" className="chat-image-open" title={image.name} aria-label={`预览${label} ${image.name}`} onClick={() => setPreview(image)}>{contents}</Button>
            : <div className="chat-file-static" title={`${image.name}（无法预览）`}>{contents}</div>}
          {onRemove && <Button type="button" className="chat-image-remove" aria-label={`删除${label} ${image.name}`} disabled={disabled} onClick={() => onRemove(image.id)}><X size={13} /></Button>}
        </div>
      })}
    </div>
    <Modal open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null) }} title={`${kind === 'image' ? '图片' : '附件'}预览：${preview?.name}`}
      bare closeOnBackdropClick contentClassName={`image-preview-content${kind !== 'image' ? ' file-preview-content' : ''}`} closeClassName="image-preview-close"
      closeLabel={kind === 'image' ? '关闭图片预览' : '关闭附件预览'}>
      {preview && (unreadable.has(preview.id) ? <p role="alert">此文件无法预览，请检查文件格式或内容。</p>
        : kind === 'image' ? <img src={preview.dataUrl} alt={preview.name} onError={() => markUnreadable(preview.id)} />
        : kind === 'text' ? <>
          <p className="file-preview-title">{preview.name}</p>
          <pre className="file-preview-text">{attachmentText(preview)}</pre>
        </>
        : kind === 'audio' ? <audio src={preview.dataUrl} controls aria-label={preview.name} onError={() => markUnreadable(preview.id)} />
        : kind === 'video' ? <video src={preview.dataUrl} controls playsInline aria-label={preview.name} onError={() => markUnreadable(preview.id)} /> : null)}
    </Modal>
  </>
}
