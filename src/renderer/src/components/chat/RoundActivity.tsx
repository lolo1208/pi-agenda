import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, Layers, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { ChatExecution, ChatMessage, ChatWorkItem } from '../../../../shared/models'
import { Button } from '../ui/button'
import { ExecutionLabel, formatExecutionDuration } from './ExecutionLabel'
import { ChatMarkdown } from './ChatMarkdown'
import { TranscriptScope, useTranscriptState } from './TranscriptState'
import { TranscriptPagedList } from './TranscriptPagedList'
import { hasPlanResult, PlanResultCard } from './PlanResultCard'

const toolLabels: Record<string, string> = { bash: '运行命令', read: '读取文件', write: '写入文件', edit: '编辑文件', delete: '删除文件', mkdir: '创建目录', rmdir: '删除目录', move: '移动或重命名', copy: '复制文件或目录', stat: '查看文件或目录信息', ls: '查看目录', find: '查找文件或目录', grep: '搜索内容', ask_user_question: '确认需求', submit_plan: '提交计划' }

function WorkItem({ item, busy = false }: { item: ChatWorkItem; busy?: boolean }): React.JSX.Element {
  const [open, setOpen] = useTranscriptState('work-open', false)
  const label = item.kind === 'thinking' ? '思考' : toolLabels[item.name ?? ''] ?? item.name ?? '工具调用'
  const preview = item.kind === 'thinking' ? item.content : String(item.args?.command ?? item.args?.path ?? JSON.stringify(item.args ?? {}))
  return <div className="chat-work-item">
    <Button variant="ghost" className="chat-work-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      {item.kind === 'thinking' ? <Sparkles size={14} /> : item.isError ? <X size={14} /> : item.completed ? <Check size={14} /> : busy ? <LoaderCircle size={14} className="chat-execution-spinner" aria-label="正在执行" /> : <LoaderCircle size={14} />}
      <span className="chat-work-summary"><span>{label}{item.isError ? ' · 执行失败' : ''}</span><small title={preview}>{preview}</small></span>
      <ChevronRight size={14} className={open ? 'chat-disclosure-chevron open' : 'chat-disclosure-chevron'} />
    </Button>
    {open && <div className="chat-work-detail">
      {item.kind === 'tool' && <><div className="chat-work-detail-label">{item.name === 'bash' ? '命令' : '输入参数'}</div><pre>{item.name === 'bash' ? String(item.args?.command ?? '') : JSON.stringify(item.args, null, 2)}</pre><div className="chat-work-detail-label">执行结果</div></>}
      <pre>{item.content || (item.completed ? '无文本输出' : '正在执行，等待结果…')}</pre>
    </div>}
  </div>
}

function CallActivity({ message, executing = false }: { message: ChatMessage; executing?: boolean }): React.JSX.Element {
  const [open, setOpen] = useTranscriptState('call-open', false)
  // 执行中的调用尚无耗时记录，从成为当前调用起本地计时，避免显示上一次调用的耗时。
  const startedRef = useRef<number | undefined>(undefined)
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!executing) { startedRef.current = undefined; return }
    startedRef.current ??= performance.now()
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(timer)
  }, [executing])
  const runningMs = executing && startedRef.current !== undefined ? now - startedRef.current : undefined
  const duration = runningMs !== undefined ? `已耗时 ${formatExecutionDuration(runningMs)}` : `耗时 ${message.call?.elapsedMs === undefined ? '未记录' : formatExecutionDuration(message.call.elapsedMs)}`
  return <div className="chat-call">
    <Button variant="ghost" className="chat-call-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      {executing ? <LoaderCircle size={14} className="chat-execution-spinner" aria-label="正在执行" /> : <Layers size={14} />}<span>{duration}</span><ChevronRight size={14} className={open ? 'chat-disclosure-chevron open' : 'chat-disclosure-chevron'} />
    </Button>
    {open && <div className="chat-work-list">{message.call?.work.length ? <TranscriptPagedList preferLatest={executing} items={message.call.work} label="工具记录">{page => page.map(item => <TranscriptScope key={item.id} id={`work:${item.id}`}><WorkItem item={item} busy={executing} /></TranscriptScope>)}</TranscriptPagedList> : <p className="chat-call-empty">{message.call ? '本次调用仅生成回复，没有工具执行或可展示的思考记录。' : '此历史调用未保存工作详情。'}</p>}</div>}
  </div>
}

export function RoundActivity({ project, messages, execution, startedAt, status, busy = false }: { project?: string | null; messages: ChatMessage[]; execution?: ChatExecution; startedAt?: number; status?: string; busy?: boolean }): React.JSX.Element {
  const [disclosure, setDisclosure] = useTranscriptState('round-open', { busy, open: busy })
  const open = disclosure.busy === busy ? disclosure.open : busy
  useEffect(() => {
    if (disclosure.busy !== busy) setDisclosure({ busy, open: busy })
  }, [busy, disclosure.busy, setDisclosure])
  const final = messages.at(-1)
  const hasPlanCards = messages.some(message => message.call?.work.some(hasPlanResult))
  return <>
    <Button variant="ghost" className="chat-round-toggle" aria-expanded={open} onClick={() => setDisclosure({ busy, open: !open })}>
      <ExecutionLabel execution={execution ?? final?.execution} startedAt={startedAt} status={status} busy={busy} /><ChevronRight size={14} className={open ? 'chat-disclosure-chevron open' : 'chat-disclosure-chevron'} />
    </Button>
    {open && <div className="chat-round-calls"><TranscriptPagedList preferLatest={busy} items={messages} label="调用记录">{(page, start) => page.map((message, offset) => { const index = start + offset; return <TranscriptScope id={`call:${index}`} key={index}><div className="chat-call-section">
      <CallActivity message={message} executing={busy && index === messages.length - 1} />
      {!hasPlanCards && message.content && (busy || index < messages.length - 1) && <ChatMarkdown project={project} content={message.content} />}
    </div></TranscriptScope> })}</TranscriptPagedList></div>}
    {hasPlanCards ? <div className="chat-round-result plan-round-results">{messages.map((message, index) => <TranscriptScope key={index} id={`plan-call:${index}`}>
      {message.content && <ChatMarkdown project={project} content={message.content} />}
      {message.call?.work.filter(hasPlanResult).map(item => <TranscriptScope key={item.id} id={`plan-result:${item.id}`}><PlanResultCard item={item} project={project} /></TranscriptScope>)}
    </TranscriptScope>)}</div> : !busy && final?.content && <div className="chat-round-result"><ChatMarkdown project={project} content={final.content} /></div>}
  </>
}
