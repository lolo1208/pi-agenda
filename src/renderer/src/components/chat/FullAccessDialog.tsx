import { useState } from 'react'
import { FolderOpen, Globe, Terminal, ShieldAlert } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/** 确认来自主进程；关闭或取消不会提升权限。 */
export function FullAccessDialog({ onRespond }: { onRespond(allow: boolean): Promise<void> }): React.JSX.Element {
  const [answering, setAnswering] = useState(false)
  const respond = (allow: boolean): void => { if (answering) return; setAnswering(true); void onRespond(allow).finally(() => setAnswering(false)) }
  return <AlertDialog open onOpenChange={open => { if (!open) respond(false) }}>
    <AlertDialogContent className="full-access-dialog" onEscapeKeyDown={event => { event.preventDefault(); respond(false) }}>
      <AlertDialogTitle>开启完全访问？</AlertDialogTitle>
      <AlertDialogDescription>完全访问会放开项目文件访问限制和普通操作审批，行动派可以：</AlertDialogDescription>
      <div className="full-access-capabilities">
        <div><FolderOpen size={17} /><span><strong>文件与文件夹</strong><small>读取和修改项目外的普通文件</small></span></div>
        <div><Terminal size={17} /><span><strong>终端命令</strong><small>执行终端命令与脚本，未知风险仍需确认</small></span></div>
        <div><Globe size={17} /><span><strong>网络访问</strong><small>执行联网命令、访问网络资源</small></span></div>
      </div>
      <p className="full-access-note">高风险或无法确定安全的操作仍需确认。项目外修改不在项目快照的回滚范围内。此权限将按会话永久保存。</p>
      <AlertDialogFooter><AlertDialogAction asChild><Button type="button" disabled={answering} onClick={event => { event.preventDefault(); respond(true) }}><ShieldAlert size={15} />开启完全访问</Button></AlertDialogAction><AlertDialogCancel asChild><Button type="button" variant="outline" disabled={answering} onClick={event => { event.preventDefault(); respond(false) }}>取消</Button></AlertDialogCancel></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
