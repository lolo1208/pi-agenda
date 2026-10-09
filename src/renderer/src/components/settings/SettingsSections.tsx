import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Moon, RotateCcw, Sun } from 'lucide-react'
import type { Preferences } from '../../preferences'
import { useRef, useState } from 'react'
import { MAX_CUSTOM_PROMPT_LENGTH, PROVIDER_PRESETS, type ModelSettings } from '../../../../shared/models'
import { unwrapModelResult } from '../../model-result'

interface PreferencesSectionProps {
  preferences: Preferences
  onPreferences: (preferences: Preferences) => void
}

export function GeneralSettingsSection({ preferences, onPreferences, isMac, settings, onModelSettingsChange, onBusyChange }: PreferencesSectionProps & {
  isMac: boolean
  settings: ModelSettings | null
  onModelSettingsChange(settings: ModelSettings): void
  onBusyChange(busy: boolean): void
}): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const usableProfiles = settings?.profiles.filter(item => item.enabled !== false && item.available !== false) ?? []
  const changeDefault = async (id: string): Promise<void> => {
    if (savingRef.current || id === settings?.activeProfileId) return
    savingRef.current = true; setSaving(true); onBusyChange(true); setError('')
    try { onModelSettingsChange(unwrapModelResult(await window.piAgenda.setActiveModel(id))) }
    catch (e) { setError(e instanceof Error ? e.message : '默认模型保存失败，请重试。') }
    finally { savingRef.current = false; setSaving(false); onBusyChange(false) }
  }
  return <>
    <h2>通用</h2>
    <p className="section-description">调整工作台的默认行为。</p>
    <section className="settings-card">
      <div className="setting-row">
        <div><h3>默认模型</h3><p>新建会话时使用，可在会话中单独切换。</p></div>
        <div className="settings-select-control settings-model-select"><Select value={usableProfiles.some(item => item.id === settings?.activeProfileId) ? settings!.activeProfileId! : ''} disabled={saving || !usableProfiles.length} onValueChange={id => { void changeDefault(id) }}>
          <SelectTrigger aria-label="默认模型"><SelectValue placeholder={settings ? '请先在模型供应商中启用模型' : '正在读取模型…'} /></SelectTrigger>
          <SelectContent>{usableProfiles.map(item => <SelectItem key={item.id} value={item.id}>{item.name} · {PROVIDER_PRESETS.find(provider => provider.id === item.provider)?.label ?? item.provider}</SelectItem>)}</SelectContent>
        </Select></div>
      </div>
      {saving && <p className="hint" role="status">正在保存默认模型…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="settings-divider" />
      <div className="setting-row">
        <div><h3>代码差异显示</h3><p>用于右侧快照中的文件对比。</p></div>
        <div className="settings-select-control settings-diff-select"><Select value={preferences.inlineDiff ? 'inline' : 'split'} onValueChange={value => onPreferences({ ...preferences, inlineDiff: value === 'inline' })}>
          <SelectTrigger aria-label="代码差异显示"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="split">左右分栏</SelectItem><SelectItem value="inline">内联对比</SelectItem></SelectContent>
        </Select></div>
      </div>
      <div className="settings-divider" />
      <div className="shortcut-setting">
        <span><b>使用 {isMac ? '⌘' : 'Ctrl'} + Enter 发送</b><small>开启时 Enter 换行；关闭时 Enter 发送，Shift + Enter 换行。</small></span>
        <div className="flex shrink-0 items-center gap-2">
          <Switch id="send-with-modifier" checked={preferences.sendWithCtrlEnter} onCheckedChange={sendWithCtrlEnter => onPreferences({ ...preferences, sendWithCtrlEnter })} />
          <Label htmlFor="send-with-modifier" className="sr-only">启用修饰键加 Enter 发送</Label>
        </div>
      </div>
    </section>
    <section className="settings-card custom-prompt-setting">
      <Label htmlFor="custom-prompt">自定义提示词</Label>
      <p id="custom-prompt-description" className="hint">每次发送消息时都会附带这些指令，对所有模型和会话生效。留空则不附加。</p>
      <Textarea id="custom-prompt" aria-describedby="custom-prompt-description" rows={5} maxLength={MAX_CUSTOM_PROMPT_LENGTH} value={preferences.customPrompt} placeholder="例如：请使用简体中文回答，先给出结论，再说明原因。" onChange={event => onPreferences({ ...preferences, customPrompt: event.target.value })} />
    </section>
    <p className="hint">设置自动保存在此设备。</p>
  </>
}

export function AppearanceSettingsSection({ preferences, onPreferences }: PreferencesSectionProps): React.JSX.Element {
  return <>
    <h2>外观</h2>
    <p className="section-description">让工作台保持舒适、清晰。</p>
    <section className="settings-card">
      <h3>主题</h3>
      <p className="hint">同时应用于任务列表、对话、设置和代码对比。</p>
      <div className="theme-options">
        {(['light', 'dark'] as const).map(theme => <Button key={theme} className={`theme-option ${theme}`} aria-pressed={preferences.theme === theme} onClick={() => onPreferences({ ...preferences, theme })}>
          <span className="theme-preview"><i /><span><b /><b /><b /></span></span>
          <span>{theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'light' ? '明色' : '暗色'}<span className="theme-check">{preferences.theme === theme ? '已选择' : ''}</span></span>
        </Button>)}
      </div>
    </section>
    <section className="settings-card font-settings">
      <div className="setting-row">
        <div><h3>界面字体</h3><p>用于菜单、设置、对话正文等界面文字。</p></div>
        <Button className="icon-button font-reset" title="恢复默认字体设置" aria-label="恢复默认字体设置" onClick={() => onPreferences({ ...preferences, font: 'inter', fontSize: 14 })}><RotateCcw size={15} /></Button>
      </div>
      <Label className="font-choice">字体
        <Select value={preferences.font} onValueChange={value => onPreferences({ ...preferences, font: value as Preferences['font'] })}>
          <SelectTrigger aria-label="界面字体"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inter">Inter（默认）</SelectItem><SelectItem value="system">系统默认</SelectItem>
            <SelectItem value="segoe">Segoe UI</SelectItem><SelectItem value="yahei">Microsoft YaHei UI</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <div className="font-preview">中文字体预览，清晰锐利 ABC xyz · a/b/c/d · a,b · 0123456789 !?&amp;<span>Inter（默认）</span></div>
      <div className="font-size-row">
        <Label htmlFor="font-size">字号</Label>
        <Input id="font-size" aria-label="字号" type="range" min="12" max="20" step="1" value={preferences.fontSize} onChange={event => onPreferences({ ...preferences, fontSize: Number(event.target.value) })} />
        <output htmlFor="font-size">{preferences.fontSize}</output>
        <Button className="icon-button font-reset" title="恢复默认字号" aria-label="恢复默认字号" onClick={() => onPreferences({ ...preferences, fontSize: 14 })}><RotateCcw size={15} /></Button>
      </div>
    </section>
  </>
}

export function AboutSettingsSection(): React.JSX.Element {
  return <>
    <h2>关于 Pi Agenda · 行动派</h2>
    <section className="settings-card">
      <h3>Pi Agenda · 行动派 <span className="muted">0.1.0</span></h3>
      <p>本地桌面 AI 编程助手</p>
      <p className="hint">已支持模型文本对话、手动快照与代码差异。文件浏览器、终端和浏览器将在后续版本实现。</p>
      <p className="hint">模型配置由本地存储管理，API Key 使用系统安全存储加密。当前对话不会自动上传项目文件。</p>
    </section>
  </>
}
