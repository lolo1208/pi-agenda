import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { ChevronRight, Columns2, File, FileCode2, FileJson, FileText, Image, List, LoaderCircle, Music, SquareTerminal, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { editor } from 'monaco-editor'

const DiffEditor = lazy(() => import('../../CodeDiff'))

/** 对比区高度：先按加载态展示，挂载后跟随实际内容自适应，最大不超过 460px。 */
const LOADING_HEIGHT = 140
const MIN_DIFF_HEIGHT = 56
const MAX_DIFF_HEIGHT = 460

export type DiffViewMode = 'unified' | 'split'

/** 窄窗口默认用统一视图，宽窗口默认分栏，与审查弹窗的可用宽度保持一致。 */
export function initialDiffViewMode(): DiffViewMode {
  return window.innerWidth < 760 ? 'unified' : 'split'
}

/**
 * 只读对比编辑器的统一参数：折叠未改动区域，只保留改动附近的上下文，
 * 阅读体验与文件审查设计稿一致。
 */
export function diffEditorOptions(mode: DiffViewMode): editor.IDiffEditorConstructionOptions {
  return {
    readOnly: true,
    originalEditable: false,
    domReadOnly: true,
    renderSideBySide: mode === 'split',
    useInlineViewWhenSpaceIsLimited: false,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 12,
    lineHeight: 20,
    padding: { top: 10, bottom: 10 },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    renderOverviewRuler: false,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    diffCodeLens: false,
    renderIndicators: true,
    // 去掉内置的分块工具栏与“复制改动行”等操作，审查视图只做阅读
    renderGutterMenu: false,
    // 关闭右键菜单（Copy / Command Palette 等），文字选中与系统复制不受影响
    contextmenu: false,
    folding: false,
    lineNumbersMinChars: 3,
    glyphMargin: false,
    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
    hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 }
  }
}

/** 只读对比视图：统一与分栏共用同一套折叠未改动区域的表现，高度跟随内容自适应。 */
export function DiffView({ before, after, mode, originalModelPath, modifiedModelPath }: {
  before: string
  after: string
  mode: DiffViewMode
  originalModelPath?: string
  modifiedModelPath?: string
}): React.JSX.Element {
  const [height, setHeight] = useState(LOADING_HEIGHT)
  const containerRef = useRef<HTMLDivElement>(null)
  const listeners = useRef<Array<{ dispose(): void }>>([])
  useEffect(() => () => { for (const listener of listeners.current) listener.dispose(); listeners.current = [] }, [])
  // 统一视图里被删除的代码是 Monaco 的视图区（不在文档模型里）：默认会在左键按下时弹出
  // “复制删除行/复制改动行”菜单，且无法框选。这里接过这段区域的鼠标事件，自己维护 DOM 选区。
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    let anchor: Range | undefined
    const inDeletedZone = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest('.view-zones .line-delete, .inline-deleted-margin-view-zone'))
    const caretAt = (x: number, y: number): Range | undefined => {
      const caret = document.caretRangeFromPoint(x, y)
      if (!caret) return undefined
      const collapsed = document.createRange()
      collapsed.setStart(caret.startContainer, caret.startOffset)
      collapsed.collapse(true)
      return collapsed
    }
    const select = (from: Range, to: Range): void => {
      const range = document.createRange()
      const forward = from.compareBoundaryPoints(Range.START_TO_START, to) <= 0
      const start = forward ? from : to
      const end = forward ? to : from
      range.setStart(start.startContainer, start.startOffset)
      range.setEnd(end.startContainer, end.startOffset)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0 || !inDeletedZone(event.target)) { anchor = undefined; return }
      event.stopPropagation()
      event.preventDefault()
      anchor = caretAt(event.clientX, event.clientY)
      if (anchor) select(anchor, anchor)
    }
    const onMouseMove = (event: MouseEvent): void => {
      if (!anchor) return
      event.stopPropagation()
      const caret = caretAt(event.clientX, event.clientY)
      if (caret) select(anchor, caret)
    }
    const onMouseUp = (event: MouseEvent): void => {
      if (!anchor) return
      anchor = undefined
      event.stopPropagation()
    }
    root.addEventListener('mousedown', onMouseDown, true)
    root.addEventListener('mousemove', onMouseMove, true)
    root.addEventListener('mouseup', onMouseUp, true)
    return () => {
      root.removeEventListener('mousedown', onMouseDown, true)
      root.removeEventListener('mousemove', onMouseMove, true)
      root.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [])
  const loading = <div className="tool-approval-preview-state" role="status"><LoaderCircle size={20} className="tool-approval-loading" aria-hidden="true" /><span>正在加载对比编辑器…</span></div>
  const syncHeight = (editor: editor.IStandaloneDiffEditor): void => {
    const content = Math.max(editor.getOriginalEditor().getContentHeight(), editor.getModifiedEditor().getContentHeight())
    setHeight(Math.min(MAX_DIFF_HEIGHT, Math.max(MIN_DIFF_HEIGHT, Math.round(content))))
  }
  return <div className="tool-approval-diff" ref={containerRef} style={{ height }}>
    <Suspense fallback={loading}>
      <DiffEditor
        original={before}
        modified={after}
        originalModelPath={originalModelPath}
        modifiedModelPath={modifiedModelPath}
        theme={document.documentElement.dataset.theme === 'dark' ? 'pi-dark' : 'pi-light'}
        loading={loading}
        options={diffEditorOptions(mode)}
        onMount={editor => {
          syncHeight(editor)
          const original = editor.getOriginalEditor()
          const modified = editor.getModifiedEditor()
          listeners.current = [
            original.onDidContentSizeChange(() => syncHeight(editor)),
            modified.onDidContentSizeChange(() => syncHeight(editor)),
            editor.onDidUpdateDiff(() => syncHeight(editor))
          ]
        }}
      />
    </Suspense>
  </div>
}

/** 统一 / 分栏分段切换控件。 */
export function DiffViewSwitch({ mode, onChange }: { mode: DiffViewMode; onChange(mode: DiffViewMode): void }): React.JSX.Element {
  return <div className="tool-approval-view-switch" role="group" aria-label="对比视图">
    <Button type="button" variant="ghost" aria-pressed={mode === 'unified'} onClick={() => onChange('unified')}><List size={14} aria-hidden="true" />统一</Button>
    <Button type="button" variant="ghost" aria-pressed={mode === 'split'} onClick={() => onChange('split')}><Columns2 size={14} aria-hidden="true" />分栏</Button>
  </div>
}

/** 新增 / 删除行数统计。 */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }): React.JSX.Element {
  return <span className="tool-approval-diffstat"><em>+{additions}</em><em className="is-del">-{deletions}</em></span>
}

/** 文件卡片标题行：折叠箭头、文件图标、文件名与路径、右侧统计。 */
export function DiffFileHeader({ icon, name, path, expanded, onToggle, trailing, hidden, ...buttonProps }: {
  icon: ReactNode
  name: string
  path: string
  expanded: boolean
  onToggle(): void
  trailing?: ReactNode
  hidden?: string
} & Omit<ComponentProps<'button'>, 'hidden'>): React.JSX.Element {
  return <button type="button" className="tool-approval-file-header" aria-expanded={expanded} onClick={onToggle} {...buttonProps}>
    <ChevronRight size={14} className="tool-approval-file-chevron" aria-hidden="true" />
    {icon}
    <span className="tool-approval-file-meta"><strong title={name}>{name}</strong><small title={path}>{path}</small></span>
    {hidden && <span className="sr-only">{hidden}</span>}
    {trailing}
  </button>
}

/**
 * 按文件后缀选图标：同类后缀共用一个图标（如 .jpg/.png 都是图片），
 * 未知类型退回通用文件图标。
 */
export function fileIcon(path: string): React.JSX.Element {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const size = 15
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'].includes(ext)) return <Image size={size} aria-hidden="true" />
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return <Music size={size} aria-hidden="true" />
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return <Video size={size} aria-hidden="true" />
  if (['json', 'jsonc', 'json5', 'yaml', 'yml', 'toml'].includes(ext)) return <FileJson size={size} aria-hidden="true" />
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'sh', 'bat', 'ps1', 'lua', 'sql'].includes(ext)) return <FileCode2 size={size} aria-hidden="true" />
  if (['md', 'mdx', 'txt', 'log', 'html', 'htm', 'css', 'scss', 'less', 'xml'].includes(ext)) return <FileText size={size} aria-hidden="true" />
  if (['exe', 'dll', 'so', 'dylib', 'bin', 'dat'].includes(ext)) return <SquareTerminal size={size} aria-hidden="true" />
  return <File size={size} aria-hidden="true" />
}

/** 取路径最后一段作为文件名。 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** 统计新增/删除行数（基于行的 LCS，用于展示 +N -N）。 */
export function diffStat(before: string, after: string): { added: number; removed: number } {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length; const m = b.length
  // 对超大文件降级为粗略计数，避免 O(n*m) 卡顿
  if (n * m > 4_000_000) {
    const setA = new Set(a)
    const setB = new Set(b)
    return { added: b.filter(line => !setA.has(line)).length, removed: a.filter(line => !setB.has(line)).length }
  }
  const dp = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i * (m + 1) + j] = a[i] === b[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1])
  }
  let added = 0; let removed = 0
  let i = 0; let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++ } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) { removed++; i++ } else { added++; j++ }
  }
  return { added: added + (m - j), removed: removed + (n - i) }
}
