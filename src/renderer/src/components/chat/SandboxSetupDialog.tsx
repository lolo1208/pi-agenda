import { useState } from 'react'
import { Check, Circle, CircleAlert, LoaderCircle, ShieldCheck, ShieldAlert, Wrench } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import type { SandboxState } from '../../../../shared/sandbox'

export function SandboxSetupDialog({ open, state, taskRunning, onClose, onRun, onStop, onFullAccess }: {
  open: boolean; state: SandboxState; taskRunning: boolean; onClose(): void
  onRun(action: 'configure' | 'diagnose' | 'check'): Promise<void>; onStop(): Promise<void>; onFullAccess(): void
}): React.JSX.Element {
  const [error, setError] = useState(''), [submitting, setSubmitting] = useState(false)
  const running = state.phase === 'running', busy = running || submitting
  const run = (action: 'configure' | 'diagnose' | 'check'): void => {
    setError(''); setSubmitting(true)
    void onRun(action).catch(reason => setError(reason instanceof Error ? reason.message : '操作未完成，请重试')).finally(() => setSubmitting(false))
  }
  const failed = state.phase === 'failed'
  return <Modal open={open} onOpenChange={value => { if (!value) onClose() }} title={running ? '安全执行环境 · 检查进度' : failed ? '安全执行环境未通过检测' : '安全执行环境'} description="通过隔离测试后，项目内终端命令可自动运行。" contentClassName="sandbox-page">
    <div className="sandbox-page-content">
      <div className="sandbox-project"><span>当前项目</span><strong title={state.project}>{state.project}</strong></div>
      <div className={`sandbox-result sandbox-${state.phase}`} role={failed ? 'alert' : 'status'}>
        {running ? <LoaderCircle className="sandbox-spin" size={20} /> : failed ? <CircleAlert size={20} /> : <ShieldCheck size={20} />}
        <div><strong>{running ? '正在配置或排查' : state.phase === 'ready' ? '可以安全自动执行' : failed ? '自动终端执行已停止' : '首次配置一次，后续自动运行'}</strong><p>{state.message}</p></div>
      </div>
      {state.steps.length > 0 && <ol className="sandbox-steps" aria-label="配置和排查进度" aria-live="polite">
        {state.steps.map(step => <li key={step.id} data-status={step.status}>
          {step.status === 'passed' ? <Check size={17} /> : step.status === 'failed' ? <CircleAlert size={17} /> : step.status === 'running' ? <LoaderCircle size={17} className="sandbox-spin" /> : <Circle size={17} />}
          <div><span>{step.label}</span>{step.detail && <p>{step.detail}</p>}</div>
          <small>{step.status === 'passed' ? '通过' : step.status === 'failed' ? '未通过' : step.status === 'running' ? '进行中' : '待检查'}</small>
        </li>)}
      </ol>}
      {!running && state.phase !== 'ready' && <div className="sandbox-guidance">
        <p>Windows 10、Windows 11 和 macOS 均可自动准备隔离环境，无需另装插件。应用会检测文件与网络边界，通过后才启用自动终端执行。</p>
        {failed && <p>排查会自动恢复应用工作目录、重建执行配置并复测隔离。系统策略、账户权限或内置程序损坏无法自动解决时，会保留失败原因；可重新配置或联系管理员。</p>}
        <p>完全访问会使用当前用户的本机权限，文件操作与命令执行不再逐项确认。应用不会替你自动切换。</p>
      </div>}
      {taskRunning && !running && <p className="sandbox-task-note">请先停止当前任务，再配置或排查。选择完全访问时会先停止任务，并请求权限确认。</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
      <footer className="sandbox-actions">
        {running ? <Button variant="outline" disabled={submitting} onClick={() => { setSubmitting(true); void onStop().catch(reason => setError(reason instanceof Error ? reason.message : '停止失败，请重试')).finally(() => setSubmitting(false)) }}>停止检查</Button> :
          state.phase === 'ready' ? <><Button variant="outline" disabled={busy || taskRunning} onClick={() => run('check')}>重新检测</Button><Button onClick={onClose}>完成</Button></> :
          <><Button variant="outline" disabled={busy} onClick={onFullAccess}><ShieldAlert size={15} />切换到完全访问</Button>
            {failed && <Button variant="outline" disabled={busy || taskRunning} onClick={() => run('configure')}>重新配置</Button>}
            <Button disabled={busy || taskRunning} onClick={() => run(failed ? 'diagnose' : state.backend ? 'check' : 'configure')}>{failed ? <Wrench size={15} /> : <ShieldCheck size={15} />}{failed ? '排查并修复基础问题' : state.backend ? '检测已有配置' : '启用安全执行环境'}</Button></>}
      </footer>
  </Modal>
}
