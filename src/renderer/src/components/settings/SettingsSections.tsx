import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ArrowRightToLine, Monitor, Moon, RotateCcw, Sun } from 'lucide-react'
import type { Preferences, ThemePreference } from '../../preferences'
import { useLayoutEffect, useRef, useState } from 'react'
import { MAX_CUSTOM_PROMPT_LENGTH, PROVIDER_PRESETS, type ModelSettings } from '../../../../shared/models'
import { unwrapModelResult } from '../../model-result'
import { ModelIcon } from '../chat/ModelIcon'

interface PreferencesSectionProps {
  preferences: Preferences
  onPreferences: (preferences: Preferences) => void
}

const CUSTOM_PROMPT_EXAMPLE = '默认使用简体中文，包括对话、文档、代码注释和日志；必要的技术术语与标识符保留原文。'
const CUSTOM_PROMPT_PLACEHOLDER = `例如：${CUSTOM_PROMPT_EXAMPLE}`

export function GeneralSettingsSection({ preferences, onPreferences, isMac, settings, onModelSettingsChange, onBusyChange }: PreferencesSectionProps & {
  isMac: boolean
  settings: ModelSettings | null
  onModelSettingsChange(settings: ModelSettings): void
  onBusyChange(busy: boolean): void
}): React.JSX.Element {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`
  }, [preferences.customPrompt])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const [promptFocused, setPromptFocused] = useState(false)
  const showPromptSuggestion = promptFocused && preferences.customPrompt === ''
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
    <section className="settings-card custom-prompt-setting">
      <Label htmlFor="custom-prompt">全局提示词</Label>
      <p id="custom-prompt-description" className="hint">每次发送消息时都会附带这些指令，对所有模型和会话生效。留空则不附加。</p>
      <div className="custom-prompt-input" data-suggestion-visible={showPromptSuggestion}>
        <Textarea ref={promptRef} id="custom-prompt" aria-describedby={showPromptSuggestion ? 'custom-prompt-description custom-prompt-shortcut' : 'custom-prompt-description'} rows={1} maxLength={MAX_CUSTOM_PROMPT_LENGTH} value={preferences.customPrompt} placeholder={CUSTOM_PROMPT_PLACEHOLDER}
          onFocus={() => setPromptFocused(true)} onBlur={() => setPromptFocused(false)}
          onChange={event => onPreferences({ ...preferences, customPrompt: event.target.value })}
          onKeyDown={event => {
            if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing && preferences.customPrompt === '') {
              event.preventDefault()
              onPreferences({ ...preferences, customPrompt: CUSTOM_PROMPT_EXAMPLE })
            }
          }} />
        {showPromptSuggestion && <>
          <div className="custom-prompt-placeholder" aria-hidden="true">{CUSTOM_PROMPT_PLACEHOLDER} <kbd><ArrowRightToLine size={12} />Tab</kbd></div>
          <span id="custom-prompt-shortcut" className="sr-only">按 Tab 填入示例提示词。</span>
        </>}
      </div>
    </section>
    <section className="settings-card">
      <div className="setting-row">
        <div><h3>默认模型</h3><p>新建会话时使用，可在会话中单独切换。</p></div>
        <div className="settings-select-control settings-model-select"><Select value={usableProfiles.some(item => item.id === settings?.activeProfileId) ? settings!.activeProfileId! : ''} disabled={saving || !usableProfiles.length} onValueChange={id => { void changeDefault(id) }}>
          <SelectTrigger aria-label="默认模型"><SelectValue placeholder={settings ? '请先在模型供应商中启用模型' : '正在读取模型…'} /></SelectTrigger>
          <SelectContent>{usableProfiles.map(item => <SelectItem key={item.id} value={item.id} textValue={`${item.name} · ${PROVIDER_PRESETS.find(provider => provider.id === item.provider)?.label ?? item.provider}`}><span className="model-name-with-icon"><span aria-hidden="true"><ModelIcon model={item.model} provider={item.provider} /></span><span>{item.name} · {PROVIDER_PRESETS.find(provider => provider.id === item.provider)?.label ?? item.provider}</span></span></SelectItem>)}</SelectContent>
        </Select></div>
      </div>
      {saving && <p className="hint" role="status">正在保存默认模型…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="settings-divider" />
      <div className="setting-row">
        <div><h3>上下文压缩阈值</h3><p>上下文占用达到该比例时，发送前自动压缩历史消息，默认 90%。</p></div>
        <div className="compression-slider-row">
          <Slider id="compression-threshold" min={60} max={95} step={5} value={[preferences.compressionThreshold]} aria-label="上下文压缩阈值" onValueChange={values => onPreferences({ ...preferences, compressionThreshold: values[0] })} className="compression-slider" />
          <output htmlFor="compression-threshold">{preferences.compressionThreshold}%</output>
        </div>
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
    <p className="hint">设置自动保存在此设备。</p>
  </>
}

const THEME_OPTIONS: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Monitor }
]
const FONT_OPTIONS: { id: Preferences['font']; label: string }[] = [
  { id: 'inter', label: 'Inter（默认）' },
  { id: 'system', label: '系统默认' },
  { id: 'segoe', label: 'Segoe UI' },
  { id: 'yahei', label: 'Microsoft YaHei UI' }
]
export function AppearanceSettingsSection({ preferences, onPreferences }: PreferencesSectionProps): React.JSX.Element {
  return <>
    <h2>外观</h2>
    <p className="section-description">让工作台保持舒适、清晰。</p>
    <section className="settings-card">
      <div className="setting-row">
        <div><h3>颜色主题</h3><p>同时应用于任务列表、对话、设置和代码对比。选择跟随系统后，会根据系统外观自动切换。</p></div>
        <RadioGroup className="theme-options" aria-label="颜色主题" value={preferences.theme} onValueChange={value => onPreferences({ ...preferences, theme: value as ThemePreference })}>
          {THEME_OPTIONS.map(({ id, label, icon: Icon }) => <RadioGroupItem key={id} variant="segmented" className="theme-option" value={id}><Icon size={15} />{label}</RadioGroupItem>)}
        </RadioGroup>
      </div>
    </section>
    <section className="settings-card">
      <div className="setting-row">
        <div><h3>界面字体</h3><p>用于菜单、设置、对话正文等界面文字。</p></div>
        <div className="font-controls">
          <Select value={preferences.font} onValueChange={value => onPreferences({ ...preferences, font: value as Preferences['font'] })}>
            <SelectTrigger aria-label="界面字体" className="font-select"><SelectValue /></SelectTrigger>
            <SelectContent>{FONT_OPTIONS.map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="font-size-control">
            <span className="font-size-label">字号</span>
            <Slider min={12} max={20} step={1} value={[preferences.fontSize]} aria-label="字号" className="font-size-slider" onValueChange={values => onPreferences({ ...preferences, fontSize: values[0] })} />
            <output>{preferences.fontSize}</output>
          </div>
          <Button variant="outline" size="icon" title="恢复默认字体设置" aria-label="恢复默认字体设置" onClick={() => onPreferences({ ...preferences, font: 'inter', fontSize: 14 })}><RotateCcw size={15} /></Button>
        </div>
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
