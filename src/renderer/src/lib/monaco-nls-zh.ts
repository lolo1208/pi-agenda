/**
 * Monaco 的语言文件替换件：拦截 monaco 内部的 nls.js 导入（见 electron.vite.config.ts），
 * 只把产品界面会展示的少量文案换成中文，其余保持 Monaco 原文。
 * Monaco 在 ESM 构建里用英文原文作为 message 参数，因此对照表以英文原文为键。
 */
const MESSAGES: Record<string, string> = {
  '{0} hidden lines': '… {0} 行未改动',
  'Click or drag to show more above': '点击或拖动显示上方更多行',
  'Click or drag to show more below': '点击或拖动显示下方更多行',
  'Double click to unfold': '双击展开全部未改动行',
  'Show Unchanged Region': '显示未改动区域',
  'Fold Unchanged Region': '折叠未改动区域'
}

function format(message: string, args: readonly unknown[]): string {
  if (args.length === 0) return message
  return message.replace(/\{(\d+)\}/g, (match, index: string) => {
    const arg = args[Number(index)]
    return typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean' ? String(arg) : match
  })
}

/** 与 Monaco 的 localize 行为一致，命中中文对照表时返回中文。 */
export function localize(_data: string | number, message: string | null, ...args: unknown[]): string {
  const source = message ?? ''
  return format(MESSAGES[source] ?? source, args)
}

/** 与 Monaco 的 localize2 行为一致，同时给出中文 value 与原始文案。 */
export function localize2(_data: string | number, originalMessage: string | null, ...args: unknown[]): { value: string, original: string } {
  const source = originalMessage ?? ''
  const message = MESSAGES[source] ?? source
  return { value: format(message, args), original: format(source, args) }
}

export function getNLSMessages(): readonly string[] | undefined {
  return (globalThis as { _VSCODE_NLS_MESSAGES?: readonly string[] })._VSCODE_NLS_MESSAGES
}

export function getNLSLanguage(): string | undefined {
  return (globalThis as { _VSCODE_NLS_LANGUAGE?: string })._VSCODE_NLS_LANGUAGE
}
