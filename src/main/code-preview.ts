import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { normalizeCodeRanges, type CodePreview } from '../shared/code-preview'

const MAX_BYTES = 2 * 1024 * 1024
function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** 只读取项目内的当前文本文件；真实路径校验阻止符号链接越界。 */
export async function readCodePreview(project: string, filename: string, input: unknown): Promise<CodePreview> {
  const ranges = normalizeCodeRanges(input)
  if (!path.isAbsolute(project) || !filename || filename.includes('\0')) throw new Error('文件路径无效')
  const resolved = path.resolve(project, filename)
  if (!inside(project, resolved)) throw new Error('只能预览当前项目内的代码文件')
  const [root, file] = await Promise.all([realpath(project), realpath(resolved)]).catch(() => { throw new Error('文件不存在或无法访问，请确认文件路径后重试') })
  if (!inside(root, file)) throw new Error('只能预览当前项目内的代码文件')
  const handle = await open(file, 'r').catch(() => { throw new Error('无法读取文件，请检查访问权限后重试') })
  let content: string
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('所选路径不是代码文件')
    if (info.size > MAX_BYTES) throw new Error('文件超过 2 MB，无法预览')
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, null)
      if (!read.bytesRead) break
      bytes += read.bytesRead
    }
    if (bytes > MAX_BYTES) throw new Error('文件超过 2 MB，无法预览')
    if (buffer.subarray(0, bytes).includes(0)) throw new Error('二进制文件不支持代码预览')
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)) }
    catch { throw new Error('文件不是有效的 UTF-8 文本，无法预览') }
  } finally { await handle.close() }
  const lines = content.split(/\r\n|\n|\r/)
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  if (ranges.some(range => range.end > lines.length)) throw new Error(`指定行号超出文件范围，当前文件共 ${lines.length} 行；请核对报告与当前文件版本`)
  const context = normalizeCodeRanges(ranges.map(range => ({ start: Math.max(1, range.start - 10), end: Math.min(lines.length, range.end + 10) })))
  if (context.reduce((sum, range) => sum + range.end - range.start + 1, 0) > 20000) throw new Error('指定代码超过 20000 行，请缩小定位范围')
  return { path: path.relative(root, file), totalLines: lines.length, content, sections: context.map(range => ({ start: range.start, lines: lines.slice(range.start - 1, range.end) })) }
}
