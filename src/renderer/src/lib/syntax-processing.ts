import { common, createLowlight } from 'lowlight'
import { isInlineFilePath, plainSyntax, type SyntaxResult, type SyntaxSource, type SyntaxToken } from './syntax-types'

const lowlight = createLowlight(common)
lowlight.registerAlias({ javascript: ['jsx', 'mjs', 'cjs'], typescript: ['tsx', 'mts', 'cts'], xml: ['vue', 'svelte'] })
const FILE_LANGUAGES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', css: 'css', scss: 'scss', less: 'less',
  json: 'json', jsonc: 'json', py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', sql: 'sql',
  go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
  md: 'markdown', ini: 'ini', toml: 'ini', kt: 'kotlin', swift: 'swift', lua: 'lua', diff: 'diff', patch: 'diff'
}
// 自动识别不同时放入 JS / TS 等相同语法家族，避免短代码总是并列。
const AUTO_LANGUAGES = ['javascript', 'xml', 'css', 'json', 'python', 'bash', 'yaml', 'sql', 'go', 'rust', 'java', 'cpp']
type SyntaxNode = ReturnType<typeof lowlight.highlight>['children'][number]

export function codeLanguage(source: SyntaxSource): string | undefined {
  if (source.language) return source.language.trim().split(/\s+/)[0].toLowerCase().replace(/^language-/, '')
  if (!source.path) return
  const filename = source.path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  if (filename === 'dockerfile') return 'dockerfile'
  if (/^makefile$/.test(filename)) return 'makefile'
  return FILE_LANGUAGES[filename.split('.').at(-1) ?? ''] ?? 'plaintext'
}

/** 仅输出文本和受限的颜色类名，不生成可执行 HTML。 */
export function highlightSyntax(source: SyntaxSource): SyntaxResult {
  const plain = plainSyntax(source.code)
  if (!source.code || source.inline && isInlineFilePath(source.code)) return plain
  try {
    const language = codeLanguage(source)
    let tree: ReturnType<typeof lowlight.highlight> | undefined
    if (language) {
      if (['text', 'txt', 'plain', 'plaintext'].includes(language) || !lowlight.registered(language)) return plain
      tree = lowlight.highlight(language, source.code)
    } else {
      // 超长、未标语言文本不尝试多次解析；已知语言的文件不受此限制。
      if (source.code.length > 64 * 1024) return plain
      let best = 0, tied = false
      for (const candidate of AUTO_LANGUAGES) {
        const current = lowlight.highlight(candidate, source.code)
        const relevance = current.data?.relevance ?? 0
        if (relevance > best) { best = relevance; tree = current; tied = false }
        else if (relevance === best && best > 0) tied = true
      }
      if (!tree || tied) return plain
    }
    const segments: SyntaxToken[] = []
    const visit = (node: SyntaxNode, inherited: string[]): void => {
      if (node.type === 'text') { segments.push({ text: node.value, className: inherited.join(' ') }); return }
      if (node.type !== 'element') return
      const classes = Array.isArray(node.properties.className) ? node.properties.className.filter(value => typeof value === 'string' && /^(?:hljs-[\w-]+|[\w]+_)$/.test(value)) as string[] : []
      // 使用最内层语法类别，避免 HTML 标签的颜色覆盖内部字符串。
      for (const child of node.children) visit(child, classes.length ? classes : inherited)
    }
    for (const node of tree.children) visit(node, [])
    if (segments.map(segment => segment.text).join('') !== source.code) return plain
    const lines: SyntaxResult['lines'] = [{ tokens: [], ending: '' }]
    for (const segment of segments) {
      const parts = segment.text.split(/(\r\n|\r|\n)/)
      parts.forEach((text, index) => {
        if (index % 2) { lines.at(-1)!.ending = text; lines.push({ tokens: [], ending: '' }) }
        else if (text) lines.at(-1)!.tokens.push({ text, className: segment.className })
      })
    }
    return { language: tree.data?.language, lines }
  } catch { return plain }
}
