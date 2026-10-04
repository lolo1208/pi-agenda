import { Button } from '@/components/ui/button'
import { Copy, FolderOpen, Minus, Square, X } from 'lucide-react'

interface WindowTitleBarProps {
  pageTitle: string
  projectName: string | null
  isMaximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function WindowTitleBar({ pageTitle, projectName, isMaximized, onMinimize, onToggleMaximize, onClose }: WindowTitleBarProps): React.JSX.Element {
  return <div className="window-titlebar">
    <div className="window-titlebar-drag" onDoubleClick={onToggleMaximize}>
      <span className="window-app-mark">π</span>
      <span className="window-app-name">Pi Console</span>
      <span className="window-title-separator" />
      <span className="window-page-title">{pageTitle}</span>
      {projectName && <span className="window-project-title"><FolderOpen size={13} />{projectName}</span>}
    </div>
    <div className="window-controls">
      <Button aria-label="最小化" title="最小化" onClick={onMinimize}><Minus size={15} /></Button>
      <Button aria-label={isMaximized ? '还原' : '最大化'} title={isMaximized ? '还原' : '最大化'} onClick={onToggleMaximize}>{isMaximized ? <Copy size={13} /> : <Square size={13} />}</Button>
      <Button className="window-close" aria-label="关闭" title="关闭" onClick={onClose}><X size={15} /></Button>
    </div>
  </div>
}
