import type { ModelReply } from '../../../../shared/models'

const tokens = (value: number): string => value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : value.toLocaleString('zh-CN')

export function LatestRound({ reply }: { reply?: ModelReply }): React.JSX.Element {
  const usage = reply?.roundUsage ?? reply?.usage
  const uncachedInput = usage ? Math.max(0, usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0)) : 0
  const seconds = reply ? Math.max(0, Math.round(reply.elapsedMs / 1000)) : 0
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : seconds ? `${seconds} 秒` : '不到 1 秒'
  const cache = usage?.cacheReadTokens !== undefined || usage?.cacheWriteTokens !== undefined
  const hit = usage && usage.inputTokens > 0 && usage.cacheReadTokens !== undefined
    ? `${Number((usage.cacheReadTokens / usage.inputTokens * 100).toFixed(1))}%` : '—'
  return <div className="subscription-round">
    <strong>最近一轮</strong>
    {reply ? <dl className="subscription-facts">
      <div><dt>Token</dt><dd>{usage ? <>{tokens(usage.inputTokens + usage.outputTokens)}<span className="subscription-fact-detail">输入 {tokens(uncachedInput)} · 输出 {tokens(usage.outputTokens)}</span></> : '暂未提供'}</dd></div>
      <div><dt>缓存</dt><dd>{cache ? <>读 {usage?.cacheReadTokens === undefined ? '—' : tokens(usage.cacheReadTokens)} · 写 {usage?.cacheWriteTokens === undefined ? '—' : tokens(usage.cacheWriteTokens)}<span className="subscription-fact-detail">命中 {hit}</span></> : '暂未提供'}</dd></div>
      <div><dt>耗时</dt><dd>{duration}</dd></div>
      <div><dt>速度</dt><dd>{usage && reply.elapsedMs > 0 ? `${Number((usage.outputTokens / (reply.elapsedMs / 1000)).toFixed(1))} tokens/秒` : '暂未提供'}</dd></div>
      <div><dt>模型</dt><dd>{reply.model}</dd></div>
    </dl> : <div className="subscription-reset">完成一次回复后显示</div>}
  </div>
}
