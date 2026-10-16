/** 保守解析完整的单条 PowerShell 字面量命令，不执行脚本或展开表达式。 */
export function literalCommand(command: string): string[] | undefined {
  if (!command.trim() || command.length > 16000 || /[\r\n`$\0]/.test(command)) return undefined
  const source = command.trim().replace(/^&[ \t]+/, '')
  const tokens: string[] = []
  let index = 0
  while (index < source.length) {
    while (/[ \t]/.test(source[index] ?? '') && index < source.length) index++
    if (index === source.length) break
    const quote = source[index] === "'" || source[index] === '"' ? source[index++] : undefined
    let value = '', closed = !quote
    while (index < source.length) {
      const character = source[index++]
      if (quote) {
        if (character === quote) {
          if (quote === "'" && source[index] === "'") { value += "'"; index++; continue }
          closed = true; break
        }
        value += character
      } else {
        if (/[ \t]/.test(character)) break
        if (/[;&|<>"'(){}\[\]@,#]/.test(character)) return undefined
        value += character
      }
    }
    if (!closed || (quote && index < source.length && !/[ \t]/.test(source[index]))) return undefined
    tokens.push(value)
  }
  return tokens.length && !tokens.includes('--%') ? tokens : undefined
}

export interface FileCommand {
  action: 'mkdir' | 'copy' | 'move' | 'remove'
  path: string
  destination?: string
  recursive?: boolean
}

/** 这里只接受不会覆盖文件、不会展开路径的有限参数；目录语义还需执行前校验。 */
export function literalFileCommand(command: string): FileCommand | undefined {
  if (/^['"]/.test(command.trim())) return undefined
  const tokens = literalCommand(command)
  if (!tokens) return undefined
  const name = tokens.shift()!.toLowerCase()
  const actions: Record<string, FileCommand['action']> = { 'new-item': 'mkdir', mkdir: 'mkdir', 'copy-item': 'copy', 'move-item': 'move', 'remove-item': 'remove', rmdir: 'remove' }
  const action = Object.hasOwn(actions, name) ? actions[name] : undefined
  if (!action) return undefined
  let source: string | undefined, destination: string | undefined, recursive = false, directory = name === 'mkdir'
  const seen = new Set<string>()
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], option = token.toLowerCase()
    if (option.startsWith('-')) {
      if (seen.has(option)) return undefined
      seen.add(option)
      if (option === '-recurse' && action !== 'mkdir' && action !== 'move') { recursive = true; continue }
      if (!['-path', '-literalpath', '-destination', '-itemtype'].includes(option) || index + 1 === tokens.length) return undefined
      const value = tokens[++index]
      if (value.startsWith('-')) return undefined
      if (option === '-path' || option === '-literalpath') { if (source !== undefined) return undefined; source = value }
      else if (option === '-destination') { if (!['copy', 'move'].includes(action) || destination !== undefined) return undefined; destination = value }
      else { if (name !== 'new-item' || value.toLowerCase() !== 'directory') return undefined; directory = true }
    } else if (source === undefined) source = token
    else if (['copy', 'move'].includes(action) && destination === undefined) destination = token
    else return undefined
  }
  if (!source || /[*?\[\]]|^~|:/.test(source.replace(/^[a-z]:[\\/]/i, '')) || destination && /[*?\[\]]|^~|:/.test(destination.replace(/^[a-z]:[\\/]/i, ''))) return undefined
  if (action === 'mkdir' && !directory || ['copy', 'move'].includes(action) && !destination) return undefined
  return { action, path: source, ...(destination ? { destination } : {}), ...(recursive ? { recursive } : {}) }
}
