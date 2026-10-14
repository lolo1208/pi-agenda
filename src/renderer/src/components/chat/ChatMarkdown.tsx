import { useId, useMemo } from 'react'
import { Lexer } from 'marked'
import { PlanContent } from './PlanContent'

/** 复用计划正文的安全渲染方式，模型输出中的 HTML 仅作为文字显示。 */
export function ChatMarkdown({ content }: { content: string }): React.JSX.Element {
  const prefix = useId()
  const tokens = useMemo(() => Lexer.lex(content, { gfm: true }), [content])
  return <PlanContent tokens={tokens} className="plan-document chat-markdown" prefix={prefix} />
}
