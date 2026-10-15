export interface SyntaxSource { code: string; language?: string; path?: string; inline?: boolean }
export interface SyntaxToken { text: string; className: string }
export interface SyntaxLine { tokens: SyntaxToken[]; ending: string }
export interface SyntaxResult { language?: string; lines: SyntaxLine[] }

export function plainSyntax(code: string): SyntaxResult {
  const parts = code.split(/(\r\n|\r|\n)/)
  return { lines: parts.filter((_, index) => index % 2 === 0).map((text, index) => ({ tokens: text ? [{ text, className: '' }] : [], ending: parts[index * 2 + 1] ?? '' })) }
}

/** 文件名和路径沿用定位样式，避免被误判为短代码。 */
export function isInlineFilePath(code: string): boolean {
  return /^\[?(?:[a-z]:[\\/]|\.{0,2}[\\/])?[^\s<>"'`]+\.[a-z\d_-]+\]?(?::\d+(?:-\d+)?)?$/i.test(code.trim())
}
