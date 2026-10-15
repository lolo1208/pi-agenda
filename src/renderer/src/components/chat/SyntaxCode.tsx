import { Fragment, type ReactNode } from 'react'
import { useSyntaxHighlight } from '../../hooks/useSyntaxHighlight'
import type { SyntaxToken } from '../../lib/syntax-types'

export function SyntaxTokens({ tokens }: { tokens: SyntaxToken[] }): ReactNode {
  return tokens.map((token, index) => token.className ? <span key={index} className={token.className}>{token.text}</span> : <Fragment key={index}>{token.text}</Fragment>)
}

/** 行内和多行代码共享着色，原始文本始终作为加载与失败回退。 */
export function SyntaxCode({ code, language, inline = false }: { code: string; language?: string; inline?: boolean }): React.JSX.Element {
  const highlighted = useSyntaxHighlight({ code, language, inline })
  const content = highlighted ? highlighted.lines.map((line, index) => <Fragment key={index}><SyntaxTokens tokens={line.tokens} />{line.ending}</Fragment>) : code
  const element = <code className="syntax-code" data-language={highlighted?.language ?? language}>{content}</code>
  return inline ? element : <pre>{element}</pre>
}
