import { Tooltip } from 'radix-ui'
import { Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatMessage, ModelProfileView, ModelRateLimit, ModelUsage } from '../../../../shared/models'

interface Props {
  project?: string | null
  profile?: ModelProfileView
  contextLimit?: number | null
  messages: ChatMessage[]
  prompt: string
  imageCount: number
  usage?: ModelUsage
  rateLimits?: ModelRateLimit[]
  onOpenProject(): void
}

// 文本估算仅用于未返回用量的服务；图片开销由服务端统计。
export function estimateTextTokens(text: string): number {
  const wide = Array.from(text).filter(character => /[^\x00-\x7F]/.test(character)).length
  return Math.ceil(wide + (text.length - wide) / 4)
}
const compact = (value: number): string => value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(value)
const number = (value: number): string => value.toLocaleString('en-US')

export function ComposerStatus({ project, profile, contextLimit, messages, prompt, imageCount, usage, rateLimits, onOpenProject }: Props): React.JSX.Element {
  const used = (usage ? usage.inputTokens + usage.outputTokens : messages.reduce((total, message) => total + estimateTextTokens(message.content) + 4, 0))
    + (prompt ? estimateTextTokens(prompt) + 4 : 0)
  const limit = profile?.contextTokens ?? contextLimit
  const percent = limit ? Math.round(used / limit * 100) : null
  const projectName = project?.split(/[\\/]/).filter(Boolean).at(-1) ?? project
  const hasImages = imageCount > 0 || (!usage && messages.some(message => message.images?.length))
  const estimated = !usage || Boolean(prompt) || imageCount > 0

  return <Tooltip.Provider delayDuration={180}>
    <div className="composer-status" aria-label="会话信息">
      {project ? <Button type="button" variant="ghost" className="composer-project" title={project} aria-label={`打开项目目录：${projectName}`} onClick={onOpenProject}><Monitor size={13} aria-hidden="true" /><span>{projectName}</span></Button>
        : <span className="composer-project"><Monitor size={13} aria-hidden="true" /><span>未关联项目</span></span>}
      <div className="composer-status-details">
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
          <Tooltip.Trigger asChild><Button type="button" variant="ghost" className={`composer-context${percent !== null && percent >= 90 ? ' context-warning' : ''}`} aria-label="当前会话上下文信息">
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle className="context-ring-track" cx="10" cy="10" r="8" /><circle className="context-ring-value" cx="10" cy="10" r="8" pathLength="100" strokeDasharray={`${Math.min(percent ?? 0, 100)} 100`} transform="rotate(-90 10 10)" /></svg>
            <span>{percent === null ? `${estimated ? '≈' : ''}${compact(used)} tokens` : `${estimated ? '≈' : ''}${percent}%`}</span>
          </Button></Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content className="composer-status-tooltip" side="top" align="end" sideOffset={8} collisionPadding={12}>
            <strong>Context — {estimated ? '约 ' : ''}{compact(used)} / {limit ? compact(limit) : '未知'}{percent !== null ? ` (${percent}%)` : ''}</strong>
            <div>{limit ? `总窗口 ${number(limit)} · 可用 ${number(Math.max(0, limit - used))} tokens` : '上下文上限未配置，使用服务默认值。'}</div>
            <div>{estimated ? '文本用量为估算值。' : '用量来自模型服务最近一次响应。'}{hasImages ? '图片 Token 开销尚未计入。' : ''}</div>
            <div>当前未启用自动压缩，此处只读。</div>
          </Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </div>
  </Tooltip.Provider>
}
