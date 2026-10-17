import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import ignore from 'ignore'
import type { ChangedFile } from '../../shared/api'

/**
 * 改动列表的展示过滤：只隐藏项目 `.gitignore` 排除的路径。
 * 快照覆盖沿用影子仓库的强制添加策略，回滚与还原仍处理这些文件，因此这里绝不参与快照读写。
 */
type ProjectMatcher = ReturnType<typeof ignore>
interface CachedRules { signature: string; at: number; directories: Map<string, ProjectMatcher> }

const IGNORE_FILE = '.gitignore'
const CACHE_TTL = 5000
const CACHE_LIMIT = 32
const cache = new Map<string, CachedRules>()

/** 与快照存储使用同一套路径规范化方式，避免同一项目出现两份缓存。 */
function canonicalRoot(root: string): string {
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Git 差异列表只有项目相对路径；异常路径一律按未忽略处理，宁可多显示也不隐藏真实改动。 */
function safeRelativePath(value: string): string | null {
  const normalized = value.split('\\').join('/')
  const segments = normalized.split('/')
  if (!normalized || path.isAbsolute(value) || segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null
  return normalized
}

/** 由深到浅列出路径的各级目录，根目录用空字符串表示，对应 Git 的规则优先级。 */
function ancestorDirectories(relative: string): string[] {
  const segments = relative.split('/')
  const directories: string[] = []
  for (let index = segments.length - 1; index > 0; index--) directories.push(segments.slice(0, index).join('/'))
  directories.push('')
  return directories
}

async function readIgnoreFile(root: string, directory: string): Promise<{ content: string; signature: string } | null> {
  const file = path.join(root, ...directory.split('/').filter(Boolean), IGNORE_FILE)
  try {
    const info = await stat(file)
    if (!info.isFile()) return null
    // 目录内规则相对该目录解析，因此每个 .gitignore 单独建立匹配器。
    return { content: await readFile(file, 'utf8'), signature: `${directory}:${info.mtimeMs}:${info.size}` }
  } catch {
    // 读取失败等同于没有规则：界面保持原样，绝不因为过滤器出错而隐藏文件。
    return null
  }
}

/** 某级目录的规则命中情况：true 忽略、false 被否定规则重新包含、undefined 无规则命中。 */
function matchRules(rules: Map<string, ProjectMatcher>, relative: string): boolean | undefined {
  for (const directory of ancestorDirectories(relative)) {
    const entry = rules.get(directory)
    if (!entry) continue
    const scoped = directory ? relative.slice(directory.length + 1) : relative
    const result = entry.test(scoped)
    if (result.ignored) return true
    if (result.unignored) return false
  }
  return undefined
}

/** 父目录本身被排除时，Git 不读取其中的 .gitignore，也不允许重新包含子文件；这里只使用严格上层规则。 */
function directoryIgnored(rules: Map<string, ProjectMatcher>, directory: string): boolean {
  for (const parent of ancestorDirectories(directory)) {
    const entry = rules.get(parent)
    if (!entry) continue
    const scoped = parent ? directory.slice(parent.length + 1) : directory
    const result = entry.test(`${scoped}/`)
    if (result.ignored) return true
    if (result.unignored) return false
  }
  return false
}

function projectIgnored(rules: Map<string, ProjectMatcher>, relative: string): boolean {
  const segments = relative.split('/')
  for (let depth = 1; depth < segments.length; depth++) {
    if (directoryIgnored(rules, segments.slice(0, depth).join('/'))) return true
  }
  return matchRules(rules, relative) === true
}

async function loadRules(root: string, directories: string[]): Promise<Map<string, ProjectMatcher>> {
  const entries = await Promise.all(directories.map(async directory => ({ directory, loaded: await readIgnoreFile(root, directory) })))
  const signature = `${canonicalRoot(root)}\0${entries.map(entry => entry.loaded?.signature ?? `${entry.directory}:-`).join('|')}`
  const key = canonicalRoot(root)
  const cached = cache.get(key)
  if (cached && cached.signature === signature && Date.now() - cached.at < CACHE_TTL) return cached.directories
  const rules = new Map<string, ProjectMatcher>()
  for (const entry of entries) {
    if (!entry.loaded) continue
    // Windows 上 Git 默认忽略大小写，跟随该行为以免同一目录显示不一致。
    const matcher = ignore({ ignorecase: process.platform === 'win32' })
    matcher.add(entry.loaded.content)
    rules.set(entry.directory, matcher)
  }
  cache.delete(key)
  cache.set(key, { signature, at: Date.now(), directories: rules })
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return rules
}

/** 过滤展示用的改动列表；快照、回滚和还原不经过这里。 */
export async function filterIgnoredChanges(root: string, changes: ChangedFile[]): Promise<ChangedFile[]> {
  if (!changes.length) return changes
  const paths = changes.map(change => safeRelativePath(change.path))
  const directories = [...new Set(paths.flatMap(relative => relative ? ancestorDirectories(relative) : []))]
  if (!directories.length) return changes
  const rules = await loadRules(root, directories)
  if (!rules.size) return changes
  return changes.filter((change, index) => {
    const relative = paths[index]
    return !relative || !projectIgnored(rules, relative)
  })
}

/** 移除项目或重建项目存储后丢弃缓存，避免读取到已失效的规则。 */
export function clearProjectIgnoreCache(root: string): void {
  cache.delete(canonicalRoot(root))
}
