import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { collectCodeReferences, normalizeCodeRanges, type CodeLineRange, type CodePreview } from '../shared/code-preview'
import { readCodePreview } from './code-preview'

type SavedFile = Omit<CodePreview, 'content'> & { ranges: CodeLineRange[]; error?: string }
interface SavedReport { project: string; capturedAt: string; files: Record<string, SavedFile> }
const projectKey = (value: string): string => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
const fileKey = (project: string, filename: string): string => projectKey(path.resolve(project, filename))

/** 每份报告独立保存，仅存被引用的代码和上下文，不保存整份源文件。 */
export async function saveCodePreviewSnapshot(directory: string, project: string, source: string): Promise<string | undefined> {
  const references = collectCodeReferences(source)
  if (!references.length) return
  const grouped = new Map<string, { path: string; ranges: CodeLineRange[] }>()
  for (const reference of references) {
    const key = fileKey(project, reference.path)
    const group = grouped.get(key)
    if (group) group.ranges.push(...reference.ranges)
    else grouped.set(key, { path: reference.path, ranges: [...reference.ranges] })
  }
  const report: SavedReport = { project: projectKey(project), capturedAt: new Date().toISOString(), files: {} }
  for (const [key, reference] of grouped) {
    try {
      const ranges = normalizeCodeRanges(reference.ranges)
      const { content: _content, ...preview } = await readCodePreview(project, reference.path, ranges)
      report.files[key] = { ...preview, ranges }
    } catch (error) {
      report.files[key] = { path: reference.path, totalLines: 0, sections: [], ranges: reference.ranges,
        error: error instanceof Error ? error.message : '代码快照保存失败' }
    }
  }
  const id = randomUUID()
  const target = path.join(directory, 'code-previews')
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, `${id}.json`), JSON.stringify(report), { encoding: 'utf8', flag: 'wx' })
  return `${path.basename(directory)}/${id}`
}

export async function readCodePreviewSnapshot(dataDirectory: string, project: string, filename: string, input: unknown, id: string): Promise<CodePreview> {
  const ranges = normalizeCodeRanges(input)
  if (id === 'pending') throw new Error('审查时代码快照正在保存，请稍后重试')
  if (id === 'unavailable') throw new Error('审查时代码快照保存失败，请重新生成报告')
  if (!/^[a-f0-9]{64}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('代码快照标识无效')
  const [session, reportId] = id.split('/')
  const report: SavedReport = await readFile(path.join(dataDirectory, 'agent-sessions', session, 'code-previews', `${reportId}.json`), 'utf8')
    .then(value => JSON.parse(value) as SavedReport).catch(() => { throw new Error('审查时代码快照不存在或无法读取，请重新生成报告') })
  if (report.project !== projectKey(project)) throw new Error('代码快照不属于当前项目')
  const file = report.files[fileKey(project, filename)]
  if (!file) throw new Error('报告中未保存此文件的代码快照')
  if (file.error) throw new Error(`审查时代码快照未能保存：${file.error}`)
  if (ranges.some(range => !file.ranges.some(saved => saved.start <= range.start && saved.end >= range.end))) throw new Error('定位范围不属于此报告')
  const context = normalizeCodeRanges(ranges.map(range => ({ start: Math.max(1, range.start - 10), end: Math.min(file.totalLines, range.end + 10) })))
  const sections = context.map(range => {
    const section = file.sections.find(saved => saved.start <= range.start && saved.start + saved.lines.length - 1 >= range.end)
    if (!section) throw new Error('代码快照片段不完整，请重新生成报告')
    return { start: range.start, lines: section.lines.slice(range.start - section.start, range.end - section.start + 1) }
  })
  // 空白补齐未保存的行，使语法高亮索引与原始行号一致。
  const lines = Array<string>(sections.at(-1)!.start + sections.at(-1)!.lines.length - 1).fill('')
  for (const section of sections) section.lines.forEach((line, index) => { lines[section.start + index - 1] = line })
  return { path: file.path, totalLines: file.totalLines, sections, content: lines.join('\n'), capturedAt: report.capturedAt }
}
