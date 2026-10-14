import { useEffect, useRef, useState } from 'react'
import type { SandboxState } from '../../../../shared/sandbox'
import { SANDBOX_CHECKS, SANDBOX_MESSAGES } from '../../../../shared/sandbox'
import { Button } from '../ui/button'

const progress: Record<string, string> = Object.fromEntries(Object.entries(SANDBOX_CHECKS).map(([id, step]) => [id, step.progress]))

/** 只提示本次完成的检测；切换权限模式不会重新展示已有结果。 */
export function SandboxStatus({ state, onInspect, visible = true }: { state: SandboxState | null; onInspect(): void; visible?: boolean }): React.JSX.Element | null {
  const [showPassed, setShowPassed] = useState(false)
  const previous = useRef(state)
  useEffect(() => {
    const completed = visible && state?.phase === 'ready' && previous.current?.phase === 'running' && previous.current.operationId === state.operationId && !state.reused
    previous.current = state
    if (state?.phase !== 'ready') { setShowPassed(false); return }
    if (!completed) return
    setShowPassed(true)
    const timer = setTimeout(() => setShowPassed(false), 4000)
    return () => clearTimeout(timer)
  }, [state?.phase, state?.operationId])
  useEffect(() => { if (!visible) setShowPassed(false) }, [visible])

  if (!visible || !state || state.phase === 'ready' && !showPassed) return null
  const step = state?.steps.find(item => item.status === 'running')
  return <div className="sandbox-entry">
    {state?.phase === 'failed'
      ? <Button variant="ghost" size="sm" onClick={onInspect}>{SANDBOX_MESSAGES.inspect}</Button>
      : <span role="status" aria-live="polite">{state?.phase === 'ready' ? SANDBOX_MESSAGES.passed : progress[step?.id ?? ''] ?? SANDBOX_MESSAGES.progress}</span>}
  </div>
}
