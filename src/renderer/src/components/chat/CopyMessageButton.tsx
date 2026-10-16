import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CopyMessageButton({ text }: { text: string }): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (status !== 'copied' && status !== 'error') return
    const timer = setTimeout(() => setStatus('idle'), 2000)
    return () => clearTimeout(timer)
  }, [status])
  const label = status === 'copied' ? '已复制' : status === 'error' ? '复制失败，请重试' : '复制消息'
  const copy = async (): Promise<void> => {
    setStatus('copying')
    try { await window.piAgenda.copyText(text); setStatus('copied') }
    catch { setStatus('error') }
  }
  return <Button type="button" variant="ghost" size="icon" className="message-copy" aria-label={label} title={label} disabled={status === 'copying'} onClick={() => void copy()}>
    {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    <span className="sr-only" role="status">{status === 'copied' || status === 'error' ? label : ''}</span>
  </Button>
}
