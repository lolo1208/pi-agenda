import type { ReactNode } from 'react'
import { PagedList } from '../PagedList'
import { useTranscriptState } from './TranscriptState'

/** 虚拟行卸载后保留页码，返回历史位置时仍显示原来的工具或文件。 */
export function TranscriptPagedList<T>({ items, label, children, preferLatest = false }: { items: readonly T[]; label: string; preferLatest?: boolean; children(items: readonly T[], start: number): ReactNode }): React.JSX.Element {
  const [selection, setSelection] = useTranscriptState(`page:${label}`, { page: 0, following: preferLatest })
  const last = Math.max(0, Math.ceil(items.length / 40) - 1)
  const page = selection.following ? last : Math.min(selection.page, last)
  return <PagedList items={items} label={label} page={page} onPageChange={next => setSelection({ page: next, following: next === last })}>{visible => children(visible, page * 40)}</PagedList>
}
