import { useId } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import type { ChatWorkItem, PlanQuestion, PlanResponse } from '../../../../shared/models'
import { Button } from '../ui/button'
import { ChatMarkdown } from './ChatMarkdown'
import { useTranscriptState } from './TranscriptState'

function responseOf(item: ChatWorkItem): PlanResponse | null {
  try {
    const value: unknown = JSON.parse(item.content)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as PlanResponse : null
  } catch { return null }
}

/** 从已保存的工具记录呈现结果，历史会话和实时会话使用同一份数据。 */
export function hasPlanResult(item: ChatWorkItem): boolean {
  if (item.kind !== 'tool' || !item.completed || item.isError) return false
  if (item.name === 'ask_user_question') {
    const answers = responseOf(item)?.answers
    return Array.isArray(item.args?.questions) && !!answers && typeof answers === 'object'
      && item.args.questions.some(question => typeof answers[question.id] === 'string')
  }
  return item.name === 'submit_plan' && typeof item.args?.title === 'string' && typeof item.args?.content === 'string'
}

export function PlanResultCard({ item, project }: { item: ChatWorkItem; project?: string | null }): React.JSX.Element {
  const [expanded, setExpanded] = useTranscriptState('plan-expanded', false)
  const contentId = useId()
  const response = responseOf(item)
  if (item.name === 'ask_user_question') {
    const questions = item.args?.questions as PlanQuestion[]
    return <section className="plan-result-card plan-answers-card" aria-label="已确认的需求">
      <dl>{questions.map(question => {
        const answer = response?.answers?.[question.id]
        if (typeof answer !== 'string') return null
        return <div className="plan-answer-row" key={question.id}>
          <dt><span aria-hidden="true">Q</span>{question.question}</dt>
          <dd><Check size={14} aria-hidden="true" /><span>{answer}</span></dd>
        </div>
      })}</dl>
    </section>
  }
  const approved = item.content.startsWith('用户已批准') || response?.decision === 'approve'
  const revised = response?.decision === 'revise'
  return <section className="plan-result-card plan-summary-card" aria-label="计划审阅结果">
    <div className="plan-card-heading"><span>计划审阅</span><span className="plan-card-status">{approved ? '已批准' : revised ? '待修改' : '已提交'}</span></div>
    <h2 className="plan-card-title">{String(item.args?.title ?? '')}</h2>
    <div id={contentId} className={`plan-card-content${expanded ? ' expanded' : ''}`} tabIndex={expanded ? undefined : -1} inert={!expanded}>
      <ChatMarkdown content={String(item.args?.content ?? '')} project={project} />
    </div>
    <Button variant="ghost" className="plan-card-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
      <ChevronRight size={14} className={expanded ? 'chat-disclosure-chevron open' : 'chat-disclosure-chevron'} aria-hidden="true" />{expanded ? '收起完整计划' : '展开完整计划'}
    </Button>
    {revised && typeof response.feedback === 'string' && <div className="plan-card-feedback"><span>修改意见</span><p>{response.feedback}</p></div>}
  </section>
}
