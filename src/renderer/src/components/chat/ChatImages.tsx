import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatImage } from '../../../../shared/models'

interface Props { images: ChatImage[]; onRemove?: (id: string) => void; disabled?: boolean }

export function ChatImages({ images, onRemove, disabled }: Props): React.JSX.Element {
  const [preview, setPreview] = useState<ChatImage | null>(null)
  return <>
    <div className="chat-images" aria-label="图片附件">
      {images.map(image => <div className="chat-image" key={image.id}>
        <Button type="button" className="chat-image-open" aria-label={`预览图片 ${image.name}`} onClick={() => setPreview(image)}>
          <img src={image.dataUrl} alt={image.name} />
        </Button>
        {onRemove && <Button type="button" className="chat-image-remove" aria-label={`删除图片 ${image.name}`} disabled={disabled} onClick={() => onRemove(image.id)}><X size={13} /></Button>}
      </div>)}
    </div>
    <Dialog.Root open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="image-preview-overlay" />
        <Dialog.Content className="image-preview-content" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">图片预览：{preview?.name}</Dialog.Title>
          {preview && <img src={preview.dataUrl} alt={preview.name} />}
          <Dialog.Close asChild><Button type="button" className="image-preview-close" aria-label="关闭图片预览"><X size={20} /></Button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
