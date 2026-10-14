import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Settings2 } from 'lucide-react'
import type { AgentSnapshot, ChatMessage, ProviderId } from '../../../../shared/models'
import { ChatImages } from './ChatImages'
import { RoundChanges } from './RoundChanges'
import { ExecutionLabel } from './ExecutionLabel'
import { RoundActivity } from './RoundActivity'
import { ChatMarkdown } from './ChatMarkdown'
import { roundChangesKey, useRoundChanges } from '../../hooks/useRoundChanges'

const HISTORY_BATCH_ROUNDS = 20

// 用户气泡按 pre-wrap 渲染原始文本；首尾空行会在气泡里留出成倍的空白，让上下边距看起来不一致，展示前收掉。
const bubbleText = (content: string): string => content.replace(/^\s+|\s+$/g, '')

interface ChatTranscriptProps {
  active?: boolean
  scrollToLatestRequest?: number
  snapshots?: import('../../../../shared/models').AgentSnapshot[]
  messages: ChatMessage[]
  pendingMessage: ChatMessage | null
  streamedText?: string
  agentStatus?: string
  isBusy?: boolean
  execution?: { model: string; provider?: ProviderId; startedAt: number; firstMessage: number }
  hasProfile: boolean
  settingsDisabled?: boolean
  onOpenSettings: () => void
}

export function ChatTranscript({ active = true, scrollToLatestRequest = 0, snapshots = [], messages, pendingMessage, streamedText = '', agentStatus, isBusy, execution, hasProfile, settingsDisabled, onOpenSettings }: ChatTranscriptProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [historyStart, setHistoryStart] = useState<number | null>(null)
  const followLatest = useRef(true)
  const lastScrollToLatestRequest = useRef(scrollToLatestRequest)
  const savedScrollTop = useRef(0)
  const prependPosition = useRef<{ height: number; top: number } | null>(null)
  const roundStarts = messages.flatMap((message, index) => message.role === 'user' ? [index] : [])
  const recentStart = roundStarts[Math.max(0, roundStarts.length - HISTORY_BATCH_ROUNDS)] ?? 0
  const startIndex = Math.min(historyStart ?? recentStart, recentStart)
  const { groups, loadedRounds } = useMemo(() => {
    const groups: { messages: ChatMessage[]; index: number; roundIndex: number; snapshots: AgentSnapshot[] }[] = []
    const anchors = new Map<string, number>()
    const messageGroups = new Map<number, typeof groups[number]>()
    let roundIndex = startIndex
    messages.forEach((message, index) => {
      if (message.snapshotHash && !anchors.has(message.snapshotHash)) anchors.set(message.snapshotHash, index)
      if (index < startIndex) return
      if (message.role === 'user') roundIndex = index
      const previous = groups.at(-1)
      if (message.role === 'assistant' && previous?.messages[0].role === 'assistant'
        && (!message.execution?.roundId || !previous.messages[0].execution?.roundId || message.execution.roundId === previous.messages[0].execution?.roundId)) previous.messages.push(message)
      else groups.push({ messages: [message], index, roundIndex, snapshots: [] })
      messageGroups.set(index, groups.at(-1)!)
    })
    for (const round of snapshots) {
      const target = anchors.get(round.after.hash) ?? round.messageIndex
      if (target !== undefined) messageGroups.get(target)?.snapshots.push(round)
    }
    return { groups, loadedRounds: groups.flatMap(group => group.snapshots) }
  }, [messages, snapshots, startIndex])
  const [viewport, setViewport] = useState<{ keys: string[]; ready: boolean }>({ keys: [], ready: false })
  const changes = useRoundChanges(loadedRounds, viewport.keys, active, Boolean(isBusy || settingsDisabled), viewport.ready)
  const measureVisible = useCallback((): void => {
    const el = scrollRef.current
    if (!active || !el || prependPosition.current) return
    const bounds = el.getBoundingClientRect()
    const visibleRounds = new Set<number>()
    if (bounds.height > 0) {
      for (const article of el.querySelectorAll<HTMLElement>('[data-round-index]')) {
        const rect = article.getBoundingClientRect()
        if (rect.bottom > bounds.top && rect.top < bounds.bottom) visibleRounds.add(Number(article.dataset.roundIndex))
      }
    }
    let keys = groups.filter(group => visibleRounds.has(group.roundIndex)).flatMap(group => group.snapshots.map(roundChangesKey))
    // 可见轮次没有文件快照时，从其后的最近轮次开始，而不是跳到会话末尾。
    if (!keys.length && visibleRounds.size) {
      const lastVisible = Math.max(...visibleRounds)
      const next = groups.find(group => group.roundIndex > lastVisible && group.snapshots.length)
        ?? [...groups].reverse().find(group => group.roundIndex < lastVisible && group.snapshots.length)
      if (next) keys = next.snapshots.map(roundChangesKey)
    }
    const ready = bounds.height > 0
    setViewport(previous => previous.ready === ready && JSON.stringify(previous.keys) === JSON.stringify(keys) ? previous : { keys, ready })
  }, [active, groups])
  const measureRef = useRef(measureVisible)
  useLayoutEffect(() => { measureRef.current = measureVisible })
  const activeStatus = isBusy ? agentStatus || '正在等待模型回复…' : undefined

  const loadEarlier = (): void => {
    const el = scrollRef.current
    if (!active || !el || startIndex === 0 || prependPosition.current) return
    const earlier = roundStarts.filter(index => index < startIndex)
    prependPosition.current = { height: el.scrollHeight, top: el.scrollTop }
    followLatest.current = false
    setHistoryStart(earlier[Math.max(0, earlier.length - HISTORY_BATCH_ROUNDS)] ?? 0)
  }

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!active || !el || prependPosition.current) return
    savedScrollTop.current = el.scrollTop
    followLatest.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 48
    // 阅读历史期间固定窗口起点，后台新增轮次不会移除正在阅读的内容。
    if (!followLatest.current && historyStart === null) setHistoryStart(startIndex)
    if (el.scrollTop <= 80 && !followLatest.current) loadEarlier()
    measureVisible()
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!active || !el) return
    // 主动发送新消息时恢复跟随，优先于历史阅读位置的恢复。
    if (lastScrollToLatestRequest.current !== scrollToLatestRequest) {
      lastScrollToLatestRequest.current = scrollToLatestRequest
      followLatest.current = true
      prependPosition.current = null
    }
    if (prependPosition.current) {
      const previous = prependPosition.current
      el.scrollTop = previous.top + el.scrollHeight - previous.height
      prependPosition.current = null
    } else {
      el.scrollTop = followLatest.current ? el.scrollHeight : savedScrollTop.current
    }
    savedScrollTop.current = el.scrollTop
  }, [active, messages, pendingMessage, streamedText, startIndex, scrollToLatestRequest])

  // 等滚动位置恢复后再测量，文件列表展开或收起也会更新优先级。
  useLayoutEffect(() => { measureVisible() })

  // 图片、折叠内容及流式回复改变高度时，仅在阅读最新消息时跟随底部。
  useLayoutEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!active || !el || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followLatest.current && !prependPosition.current) {
        el.scrollTop = el.scrollHeight
        savedScrollTop.current = el.scrollTop
      }
      measureRef.current()
    })
    observer.observe(content)
    observer.observe(el)
    return () => observer.disconnect()
  }, [active])

  // 滚动条会占用布局宽度，把实测宽度写入 CSS 变量，供输入框侧补偿对齐
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!active || !el) return
    const update = () => {
      const width = el.scrollHeight > el.clientHeight ? el.offsetWidth - el.clientWidth : 0
      el.parentElement?.style.setProperty('--chat-scrollbar', `${width}px`)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [active, messages, pendingMessage, streamedText, startIndex])

  return <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
    {!messages.length && !pendingMessage && <div className="chat-welcome">
      <div className="welcome-brand">
        <div className="welcome-mark"><img src="./icons/app-icon.png" alt="" draggable={false} /></div>
        <span className="welcome-app-name">Pi Agenda · 行动派</span>
      </div>
      <h1>今天，想完成什么？</h1>
      <p>从一个想法、一个问题，或一项新任务开始。</p>
      {!hasProfile && <Button disabled={settingsDisabled} onClick={onOpenSettings}><Settings2 size={16} />配置模型</Button>}
    </div>}
    <div className="chat-messages" ref={contentRef} aria-live="polite">
      {startIndex > 0 && <div className="chat-history-loader"><Button variant="ghost" onClick={loadEarlier}>显示更早的 {HISTORY_BATCH_ROUNDS} 轮对话</Button></div>}
      {groups.map(({ messages: roundMessages, index, roundIndex, snapshots: groupSnapshots }) => {
        const message = roundMessages[0]
        const busy = Boolean(isBusy && execution && index + roundMessages.length > execution.firstMessage)
        return <article className={`chat-message ${message.role}`} key={index} data-round-index={roundIndex}>
        {message.role === 'assistant' && <RoundActivity messages={roundMessages} busy={busy} execution={busy ? execution : roundMessages.at(-1)?.execution} startedAt={busy ? execution?.startedAt : undefined} status={busy ? activeStatus : undefined} />}
        {Boolean(message.images?.length) && <ChatImages images={message.images!} />}
        {message.role === 'user' && message.content && <p>{bubbleText(message.content)}</p>}
        {groupSnapshots.map(round => {
          const key = roundChangesKey(round)
          return <RoundChanges key={key} round={round} data={changes.data[key]} onRetry={() => changes.retry(round)} disabled={isBusy || settingsDisabled} />
        })}
      </article>})}
      {pendingMessage && <>
        <article className="chat-message user">
          {Boolean(pendingMessage.images?.length) && <ChatImages images={pendingMessage.images!} />}
          {pendingMessage.content && <p>{bubbleText(pendingMessage.content)}</p>}
        </article>
        {!isBusy && <div className="thinking" role="status"><span className="busy-dot" />正在等待模型回复…</div>}
      </>}
      {(streamedText || isBusy && !messages.slice(execution?.firstMessage ?? messages.length).some(message => message.role === 'assistant')) && <article className="chat-message assistant" aria-label="正在生成的回复"><ExecutionLabel execution={execution} startedAt={execution?.startedAt} status={activeStatus} busy />{streamedText && <ChatMarkdown content={streamedText} />}</article>}
    </div>
  </div>
}
