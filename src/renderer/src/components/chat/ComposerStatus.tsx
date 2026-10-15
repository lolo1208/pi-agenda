import { Tooltip } from 'radix-ui'
import { Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatAttachment, ChatMessage, ModelProfileView, ModelRateLimit, ModelReply, ModelUsage } from '../../../../shared/models'
import { DEFAULT_COMPRESSION_THRESHOLD, estimateContextTokens } from '../../../../shared/context'
export { estimateTextTokens } from '../../../../shared/context'
import { SubscriptionLimits } from './SubscriptionLimits'
import { OpenrouterLimits } from './OpenrouterLimits'

interface Props {
  project?: string | null
  profile?: ModelProfileView
  contextLimit?: number | null
  messages: ChatMessage[]
  prompt: string
  instruction?: string
  attachments?: ChatAttachment[]
  compressionThreshold?: number
  usage?: ModelUsage
  latestReply?: ModelReply
  rateLimits?: ModelRateLimit[]
  subscriptionUsage?: import('../../../../shared/models').ChatgptUsage
  openrouterUsage?: import('../../../../shared/models').OpenrouterUsage
  onOpenProject(): void
}

const compact = (value: number): string => value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(value)
const number = (value: number): string => value.toLocaleString('en-US')

export function ComposerStatus({ project, profile, contextLimit, messages, prompt, instruction = '', attachments, usage, latestReply, rateLimits, subscriptionUsage, openrouterUsage, compressionThreshold = DEFAULT_COMPRESSION_THRESHOLD, onOpenProject }: Props): React.JSX.Element {
  const measured = usage && usage.inputTokens + usage.outputTokens > 0 ? usage : undefined
  const lastAssistantIndex = messages.map(message => message.role).lastIndexOf('assistant')
  const trailing = measured && lastAssistantIndex >= 0 ? messages.slice(lastAssistantIndex + 1) : []
  const used = (measured ? measured.inputTokens + measured.outputTokens : estimateContextTokens(messages, instruction))
    + estimateContextTokens(trailing)
    + (prompt || attachments?.length ? estimateContextTokens([{ role: 'user', content: prompt, images: attachments }]) : 0)
  const limit = profile?.contextTokens ?? contextLimit
  const percent = limit ? Math.round(used / limit * 100) : null
  const projectName = project?.split(/[\\/]/).filter(Boolean).at(-1) ?? project
  const estimated = !measured || trailing.length > 0 || Boolean(prompt) || Boolean(attachments?.length)
  const warning = percent !== null && percent >= compressionThreshold
  const meterWidth = percent === null ? 0 : Math.min(percent, 100)

  return <Tooltip.Provider delayDuration={180}>
    <div className="composer-status" aria-label="会话信息">
      {project ? <Button type="button" variant="ghost" className="composer-project" title={project} aria-label={`打开项目目录：${projectName}`} onClick={onOpenProject}><Monitor size={13} aria-hidden="true" /><span>{projectName}</span></Button>
        : <span className="composer-project"><Monitor size={13} aria-hidden="true" /><span>未关联项目</span></span>}
      <div className="composer-status-details">
        {profile?.provider === 'chatgpt' && <SubscriptionLimits usage={subscriptionUsage} latestReply={latestReply} />}
        {profile?.provider === 'openrouter' && <OpenrouterLimits model={profile.model} usage={openrouterUsage} latestReply={latestReply} />}
        {profile?.provider === 'openai' && <Tooltip.Root>
          <Tooltip.Trigger asChild><Button type="button" variant="ghost" className="composer-limits" aria-label="当前模型使用限制">
            {rateLimits?.length ? rateLimits.map(item => <span key={item.kind}>{item.kind === 'requests' ? '请求' : 'Token'} 剩余 {Math.round(item.remaining / item.limit * 100)}%</span>) : '使用限制：暂未提供'}
          </Button></Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content className="composer-status-tooltip" side="top" align="end" sideOffset={8} collisionPadding={12}>
            <strong>当前模型使用限制</strong>
            {rateLimits?.length ? rateLimits.map(item => <div key={item.kind}>{item.kind === 'requests' ? '请求' : 'Token'}：剩余 {number(item.remaining)} / {number(item.limit)}{item.reset ? ` · ${item.reset} 后重置` : ''}</div>) : <div>模型服务尚未返回使用限制。</div>}
            <div>显示最近一次请求返回的 API 限制。</div>
          </Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>}
        <Tooltip.Root>
          <Tooltip.Trigger asChild><Button type="button" variant="ghost" className={`composer-context${warning ? ' context-warning' : ''}`} aria-label="当前会话上下文信息">
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle className="context-ring-track" cx="10" cy="10" r="8" /><circle className="context-ring-value" cx="10" cy="10" r="8" pathLength="100" strokeDasharray={`${meterWidth} 100`} transform="rotate(-90 10 10)" /></svg>
            <span>{percent === null ? `${compact(used)} tokens` : `${percent}%`}</span>
          </Button></Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content className="composer-status-tooltip context-tooltip" side="top" align="end" sideOffset={8} collisionPadding={12}>
            <div className="context-tooltip-heading"><span>上下文占用</span><b className={warning ? 'is-warning' : undefined}>{percent === null ? '—' : `${percent}%`}</b></div>
            <div aria-hidden="true" className="context-tooltip-meter"><div className={warning ? 'is-warning' : undefined} style={{ width: `${meterWidth}%` }} /></div>
            <div className="context-tooltip-figures"><span>{estimated ? '≈ ' : ''}{number(used)} tokens</span>{limit ? <span>/ {number(limit)}</span> : null}</div>
            {!limit && <div className="context-tooltip-note context-tooltip-note-plain">该模型未配置上下文上限。</div>}
            {warning && <div className="context-tooltip-note">达到 {compressionThreshold}% 后发送前自动压缩历史。</div>}
          </Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </div>
  </Tooltip.Provider>
}
