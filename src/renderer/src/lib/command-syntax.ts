import type { SyntaxLine, SyntaxResult, SyntaxToken } from './syntax-types'

/**
 * 通用 hljs 语法对终端命令着色很弱（git、npm 等命令首词不会命中 built_in），
 * 审批弹窗需要稳定可见的着色，因此按 Shell 词法给出：命令首词、选项、字符串、变量、运算符和注释。
 */
const COMMAND_SEPARATOR = /^(?:&&|\|\||\|&|[|;&])/
/** 重定向符之后仍是同一条命令，下一词不是命令首词。 */
const REDIRECT = /^(?:>>|<<|>&|<&|[<>])/
const VARIABLE = /^(?:\$\{[^}]*\}|\$env:[A-Za-z_][\w]*|\$[A-Za-z_][\w]*|%[A-Za-z_][\w]*%)/
const FLAG = /^(?:-{1,2}[A-Za-z][\w-]*|\/[A-Za-z][\w-]*)/

function closingQuote(text: string, start: number, quote: string): number {
  for (let index = start + 1; index < text.length; index++) {
    if (quote === '"' && text[index] === '\\') { index++; continue }
    if (text[index] === quote) return index + 1
  }
  return text.length
}

function lineTokens(text: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = []
  const push = (value: string, className: string): void => { if (value) tokens.push({ text: value, className }) }
  let index = 0
  // 行首和命令连接符之后的首个词是可执行命令，单独着色。
  let head = true
  while (index < text.length) {
    const rest = text.slice(index)
    const whitespace = /^\s+/.exec(rest)
    if (whitespace) { push(whitespace[0], ''); index += whitespace[0].length; continue }
    if (rest[0] === '#') { push(rest, 'hljs-comment'); break }
    const separator = COMMAND_SEPARATOR.exec(rest)
    if (separator) { push(separator[0], 'hljs-keyword'); index += separator[0].length; head = true; continue }
    const redirect = REDIRECT.exec(rest)
    if (redirect) { push(redirect[0], 'hljs-keyword'); index += redirect[0].length; head = false; continue }
    const quote = rest[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      const end = closingQuote(text, index, quote)
      push(text.slice(index, end), 'hljs-string'); index = end; head = false; continue
    }
    const variable = VARIABLE.exec(rest)
    if (variable) { push(variable[0], 'hljs-variable'); index += variable[0].length; head = false; continue }
    const word = /^[^\s|&;<>"'`]+/.exec(rest)
    if (!word) { push(rest[0], ''); index++; continue }
    push(word[0], FLAG.test(word[0]) ? 'hljs-literal' : head ? 'hljs-built_in' : '')
    index += word[0].length; head = false
  }
  return tokens
}

export function highlightCommand(code: string): SyntaxResult {
  const parts = code.split(/(\r\n|\r|\n)/)
  const lines: SyntaxLine[] = parts.filter((_, index) => index % 2 === 0).map((text, index) => ({ tokens: lineTokens(text), ending: parts[index * 2 + 1] ?? '' }))
  return { language: 'shell', lines }
}
