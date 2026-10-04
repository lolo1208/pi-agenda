import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useState } from 'react'
import { PROVIDER_PRESETS, type ModelProfile, type ModelSettings, type ProviderId } from '../../shared/models'
import { ModelProfileFields } from './components/ModelProfileFields'
import { ModelProfileActions } from './components/ModelProfileActions'
import { unwrapModelResult } from './model-result'

function newProfile(provider: ProviderId = 'openai'): ModelProfile {
  const preset = PROVIDER_PRESETS.find(item => item.id === provider)!
  return { id: crypto.randomUUID(), name: preset.label, provider, protocol: preset.protocol, baseUrl: preset.baseUrl,
    model: '', temperature: null, maxTokens: 2048, tokenParameter: provider === 'openai' ? 'max_completion_tokens' : 'max_tokens', timeoutSeconds: 60 }
}

interface Props { settings: ModelSettings; onChange(settings: ModelSettings): void; onClose(): void; onBusyChange?(busy: boolean): void }
export default function ModelSettingsPanel({ settings, onChange, onClose, onBusyChange }: Props): React.JSX.Element {
  const [profile, setProfile] = useState<ModelProfile>(() => settings.profiles.find(item => item.id === settings.activeProfileId) ?? newProfile())
  const [apiKey, setApiKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deletePending, setDeletePending] = useState(false)
  const saved = settings.profiles.find(item => item.id === profile.id)
  const update = <K extends keyof ModelProfile>(field: K, value: ModelProfile[K]): void => {
    setProfile(current => ({ ...current, [field]: value })); setNotice(''); setDeletePending(false)
  }
  const run = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true); onBusyChange?.(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { setIsBusy(false); onBusyChange?.(false); setRequestId(null) }
  }
  const save = async (): Promise<ModelSettings> => {
    const next = unwrapModelResult(await window.piConsole.saveModelProfile({ profile,
      credential: apiKey.trim() ? { action: 'replace', value: apiKey } : { action: removeKey ? 'remove' : 'keep' } }))
    onChange(next); setApiKey(''); setRemoveKey(false)
    setProfile(next.profiles.find(item => item.id === profile.id)!)
    return next
  }
  const changeProfile = (id: string): void => {
    setProfile(settings.profiles.find(item => item.id === id) ?? newProfile())
    setApiKey(''); setRemoveKey(false); setError(''); setNotice(''); setDeletePending(false)
  }
  const saveProfile = (): void => { void run(async () => { await save(); setNotice('配置已保存') }) }
  const saveAndActivate = (): void => { void run(async () => { await save(); onChange(unwrapModelResult(await window.piConsole.setActiveModel(profile.id))); setNotice('已保存并设为当前模型') }) }
  const saveAndTest = (): void => { void run(async () => {
    await save()
    const id = crypto.randomUUID(); setRequestId(id)
    const result = unwrapModelResult(await window.piConsole.testModel(profile.id, id))
    setNotice(`连接成功 · ${result.elapsedMs} ms · ${result.model}${result.truncated ? '（测试输出达到 Token 上限）' : ''}`)
  }) }
  const deleteProfile = (): void => { void run(async () => {
    const next = unwrapModelResult(await window.piConsole.deleteModelProfile(profile.id))
    onChange(next)
    setProfile(newProfile()); setApiKey(''); setRemoveKey(false); setDeletePending(false); setNotice('配置已删除')
  }) }
  return <section className="model-settings" aria-labelledby="model-settings-title">
    <div className="section-heading"><h2 id="model-settings-title">模型设置</h2><Button disabled={isBusy} onClick={onClose}>返回对话</Button></div>
    <p className="hint">可保存多个配置。模型 ID 请填写服务端提供的准确名称；这里只发送聊天消息，不自动上传项目文件。切换当前模型后，后续消息及任务历史将发送到新配置。</p>
    {!settings.encryptionAvailable && <p className="error" role="status">系统安全存储不可用，不能保存或读取 API Key；无密钥的本地服务仍可使用。</p>}
    <fieldset disabled={isBusy}>
      <Label>编辑配置<Select value={saved ? profile.id : '__new__'} onValueChange={value => changeProfile(value === '__new__' ? '' : value)} disabled={isBusy}>
        <SelectTrigger aria-label="编辑配置"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__new__">新建配置</SelectItem>{settings.profiles.map(item => <SelectItem key={item.id} value={item.id}>{item.name}{item.id === settings.activeProfileId ? '（当前）' : ''}</SelectItem>)}</SelectContent>
      </Select></Label>
      <ModelProfileFields profile={profile} savedProfile={saved} settings={settings} apiKey={apiKey} removeKey={removeKey} onFieldChange={update}
        onProviderChange={provider => {
        const preset = newProfile(provider)
        setProfile({ ...preset, id: profile.id }); setApiKey(''); setRemoveKey(Boolean(saved?.hasApiKey)); setNotice('')
      }} onApiKeyChange={setApiKey} onRemoveKeyChange={remove => { setRemoveKey(remove); setApiKey('') }} />
      <ModelProfileActions hasSavedProfile={Boolean(saved)} deletePending={deletePending} onSave={saveProfile} onSaveAndActivate={saveAndActivate} onSaveAndTest={saveAndTest}
        onRequestDelete={() => setDeletePending(true)} onConfirmDelete={deleteProfile} onCancelDelete={() => setDeletePending(false)} />
    </fieldset>
    {requestId && <Button onClick={() => { void window.piConsole.cancelModelRequest(requestId).then(unwrapModelResult).catch(() => setError('取消请求失败，请重试')) }}>取消连接测试</Button>}
    {isBusy && <p role="status" className="hint">{requestId ? '正在请求模型…' : '正在保存配置…'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
  </section>
}




