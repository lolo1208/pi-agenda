import { useEffect, useState } from 'react'
import { Dialog } from 'radix-ui'
import { ArrowLeft, ChevronRight, Cpu, Plus, RefreshCw, Search, Server, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PROVIDER_PRESETS, type ModelDescriptor, type ModelProfile, type ModelProfileView, type ModelSettings, type ProviderId } from '../../shared/models'
import { ModelProfileFields } from './components/ModelProfileFields'
import { ModelProfileActions } from './components/ModelProfileActions'
import { unwrapModelResult } from './model-result'
import { ChatgptAuthorization } from './components/ChatgptAuthorization'

function newProfile(provider: ProviderId): ModelProfile {
  const preset = PROVIDER_PRESETS.find(item => item.id === provider)!
  return { id: crypto.randomUUID(), name: preset.label, provider, protocol: preset.protocol, baseUrl: preset.baseUrl,
    model: '', temperature: null, maxTokens: 2048, tokenParameter: provider === 'openai' ? 'max_completion_tokens' : 'max_tokens', timeoutSeconds: 60 }
}
function providerName(provider: ProviderId): string { return PROVIDER_PRESETS.find(item => item.id === provider)!.label }
function ProviderIcon({ provider }: { provider: ProviderId }): React.JSX.Element {
  return <span className="provider-icon" aria-hidden="true">{provider === 'ollama' ? <Server size={19} /> : <Cpu size={19} />}</span>
}
interface Props { settings: ModelSettings; onChange(settings: ModelSettings): void; onClose(): void; onBusyChange?(busy: boolean): void }
export default function ModelSettingsPanel({ settings, onChange, onClose, onBusyChange }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<ProviderId | null>(() => settings.profiles.find(item => item.id === settings.activeProfileId)?.provider ?? settings.profiles[0]?.provider ?? null)
  const [profile, setProfile] = useState<ModelProfile>(() => newProfile('ollama'))
  const [dialog, setDialog] = useState<'choose' | 'configure' | null>(null)
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [providerQuery, setProviderQuery] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deletePending, setDeletePending] = useState(false)
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [modelInfo, setModelInfo] = useState<ModelDescriptor | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoError, setInfoError] = useState('')
  const [infoRevision, setInfoRevision] = useState(0)
  const saved = settings.profiles.find(item => item.id === profile.id)
  const providers = [...new Set([...settings.profiles.map(item => item.provider), ...(settings.providers ?? []).map(item => item.provider)])]
  const ollamaConnection = settings.providers?.find(item => item.provider === 'ollama')
  const currentOllamaUrl = ollamaConnection?.baseUrl ?? settings.profiles.find(item => item.provider === 'ollama')?.baseUrl ?? 'http://localhost:11434'
  const currentProvider = selected && providers.includes(selected) ? selected : providers[0] ?? null
  const models = settings.profiles.filter(item => item.provider === currentProvider)
  const filteredModels = models.filter(item => `${item.name} ${item.model}`.toLowerCase().includes(query.trim().toLowerCase()))
  const options = (['chatgpt', 'ollama'] as const).filter(provider => `${providerName(provider)} ${provider === 'chatgpt' ? '订阅 OpenAI ChatGPT' : '本地'}`.toLowerCase().includes(providerQuery.trim().toLowerCase()))
  const subscription = profile.provider === 'chatgpt' && !editing
  const connectingOllama = dialog === 'configure' && profile.provider === 'ollama' && !editing
  useEffect(() => {
    if (dialog === 'configure' && editing && profile.provider === 'chatgpt') { setModelInfo(settings.providers?.find(item => item.provider === 'chatgpt')?.models.find(item => item.id === profile.model) ?? null); setInfoError(''); setInfoLoading(false); return }
    if (dialog !== 'configure' || !editing || profile.provider !== 'ollama') { setModelInfo(null); setInfoError(''); setInfoLoading(false); return }
    let disposed = false
    setModelInfo(ollamaConnection?.baseUrl === profile.baseUrl.replace(/\/v1\/?$/, '') ? ollamaConnection.models.find(item => item.id === profile.model) ?? null : null)
    setInfoLoading(true); setInfoError('')
    void window.piAgenda.getOllamaModelInfo(profile.baseUrl, profile.model).then(unwrapModelResult).then(info => { if (!disposed) setModelInfo(current => ({ ...info, sizeBytes: info.sizeBytes ?? current?.sizeBytes })) }).catch(e => {
      if (!disposed) setInfoError(e instanceof Error ? e.message : '模型信息读取失败，请重试')
    }).finally(() => { if (!disposed) setInfoLoading(false) })
    return () => { disposed = true }
  }, [dialog, editing, profile.id, profile.baseUrl, profile.model, infoRevision, ollamaConnection, settings.providers])
  const update = <K extends keyof ModelProfile>(field: K, value: ModelProfile[K]): void => {
    setProfile(current => ({ ...current, [field]: value })); setNotice(''); setDeletePending(false)
  }
  const run = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true); onBusyChange?.(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { setIsBusy(false); onBusyChange?.(false); setRequestId(null) }
  }
  const save = async (): Promise<void> => {
    if (profile.contextTokens != null && modelInfo?.maxContextTokens != null && profile.contextTokens > modelInfo.maxContextTokens) throw new Error('上下文上限不能超过模型支持的最大上下文')
    const next = unwrapModelResult(await window.piAgenda.saveModelProfile({ profile,
      credential: apiKey.trim() ? { action: 'replace', value: apiKey } : { action: removeKey ? 'remove' : 'keep' } }))
    onChange(next); setApiKey(''); setRemoveKey(false); setSelected(profile.provider)
    setProfile(next.profiles.find(item => item.id === profile.id)!); setEditing(true)
  }
  const configure = (provider: ProviderId, existing?: ModelProfile): void => {
    setProfile(existing ?? newProfile(provider)); setEditing(Boolean(existing)); setDialog('configure')
    setApiKey(''); setRemoveKey(false); setError(''); setNotice(''); setDeletePending(false)
    if (provider === 'ollama' && !existing) setOllamaUrl(currentOllamaUrl.replace(/\/v1\/?$/, ''))
  }
  const connectOllama = (baseUrl: string, close = false): void => { void run(async () => {
    const next = unwrapModelResult(await window.piAgenda.connectOllama(baseUrl))
    onChange(next); setSelected('ollama'); setQuery('')
    if (close) setDialog(null)
    const count = next.providers?.find(item => item.provider === 'ollama')?.models.length ?? 0
    setNotice(count ? `已读取 ${count} 个 Ollama 模型` : 'Ollama 已连接，尚未发现模型。请先使用 ollama pull 下载模型，再刷新列表。')
  }) }
  const toggleModel = (item: ModelProfileView): void => { void run(async () => {
    const next = unwrapModelResult(await window.piAgenda.saveModelProfile({ profile: { ...item, enabled: item.enabled === false }, credential: { action: 'keep' } }))
    onChange(next)
    if (item.id === profile.id) setProfile(next.profiles.find(profile => profile.id === item.id)!)
    setNotice(item.enabled === false ? `已启用 ${item.name}` : `已停用 ${item.name}`)
  }) }
  const saveProfile = (): void => { void run(async () => { await save(); setNotice('配置已保存') }) }
  const saveAndTest = (): void => { void run(async () => {
    await save()
    const id = crypto.randomUUID(); setRequestId(id)
    const result = unwrapModelResult(await window.piAgenda.testModel(profile.id, id))
    setNotice(`连接成功 · ${result.elapsedMs} ms · ${result.model}${result.truncated ? '（测试输出达到 Token 上限）' : ''}`)
  }) }
  const deleteProfile = (): void => { void run(async () => {
    onChange(unwrapModelResult(await window.piAgenda.deleteModelProfile(profile.id)))
    setDialog(null); setNotice('配置已删除')
  }) }
  const feedback = <>
    {requestId && <Button onClick={() => { void window.piAgenda.cancelModelRequest(requestId).then(unwrapModelResult).catch(() => setError('取消请求失败，请重试')) }}>取消连接测试</Button>}
    {isBusy && <p role="status" className="hint">{requestId ? '正在请求模型…' : '正在处理配置…'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
  </>
  return <section className="model-settings" aria-labelledby="model-settings-title">
    <div className="section-heading"><h2 id="model-settings-title">模型供应商</h2><Button variant="ghost" disabled={isBusy} onClick={onClose}>返回对话</Button></div>
    <p className="section-description">管理模型来源、连接方式与各模型的独立配置。</p>
    <div className="provider-workspace">
      <aside className="provider-sidebar" aria-label="已配置的模型供应商">
        <p className="provider-sidebar-label">已配置的供应商</p>
        <nav aria-label="供应商列表">{providers.map(provider => <Button key={provider} variant="ghost" disabled={isBusy} className="provider-nav-item" aria-current={provider === currentProvider ? 'page' : undefined} onClick={() => { setSelected(provider); setQuery(''); setError(''); setNotice('') }}>
          <ProviderIcon provider={provider} /><span>{providerName(provider)}</span><small>{settings.profiles.filter(item => item.provider === provider).length} 个模型</small>
        </Button>)}</nav>
        {!providers.length && <p className="hint provider-sidebar-empty">添加供应商后，将在这里显示。</p>}
        <Button variant="outline" className="provider-add" disabled={isBusy} onClick={() => { setEditing(false); setDialog('choose'); setProviderQuery(''); setError(''); setNotice('') }}><Plus size={16} />添加供应商</Button>
      </aside>
      <div className="provider-detail">
        {currentProvider ? <>
          <header className="provider-detail-heading"><ProviderIcon provider={currentProvider} /><div><h3>{providerName(currentProvider)}</h3><p>{currentProvider === 'ollama' ? '本地服务 · Ollama' : currentProvider === 'chatgpt' ? 'ChatGPT 订阅账号' : 'API 配置'}</p></div><span className="provider-badge">已配置</span></header>
          <div className="provider-connection-summary"><span>连接方式</span><strong>{currentProvider === 'ollama' ? currentOllamaUrl : currentProvider === 'chatgpt' ? '浏览器授权' : 'API 连接'}</strong>{currentProvider === 'ollama' && <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => configure('ollama')}>配置连接</Button>}<p>每个模型的上下文与生成参数独立保存。</p>{currentProvider === 'chatgpt' && !dialog && <ChatgptAuthorization onChange={onChange} />}</div>
          <div className="provider-model-toolbar"><div><h4>模型 <span>{models.length}</span></h4><p>启用需要的模型，默认模型可在通用设置中选择。</p></div>{currentProvider === 'ollama' && <Button size="sm" variant="outline" disabled={isBusy} onClick={() => connectOllama(currentOllamaUrl)}><RefreshCw size={14} />刷新模型</Button>}</div>
          <div className="search-field provider-model-search"><Search size={15} /><Input aria-label="搜索模型" placeholder="搜索模型名称或 ID" value={query} onChange={event => setQuery(event.target.value)} /></div>
          <ul className="provider-model-list">{filteredModels.map(item => <li key={item.id}>
            <ProviderIcon provider={item.provider} /><div className="provider-model-name" title={item.name}><strong>{item.name}{item.available === false ? ' · 当前不可用' : item.enabled === false ? ' · 已停用' : ''}</strong></div>
            <div className="provider-model-actions"><Button size="icon" variant="ghost" disabled={isBusy} aria-label={`配置 ${item.name}`} title="模型高级设置" onClick={() => configure(item.provider, item)}><SlidersHorizontal size={16} /></Button>
              <Switch aria-label={`启用 ${item.name}`} checked={item.enabled !== false} disabled={isBusy || item.available === false} onCheckedChange={() => toggleModel(item)} /></div>
          </li>)}</ul>
          {!filteredModels.length && <p className="provider-no-results">{query ? '没有匹配的模型，请尝试其他关键词。' : currentProvider === 'ollama' ? '本地还没有模型。请使用 ollama pull 下载模型，再点击“刷新模型”。' : '暂无模型。'}</p>}
        </> : <div className="provider-empty"><Cpu size={30} /><h3>添加你的第一个模型供应商</h3><p>连接 OpenAI 订阅账号，或配置本地 Ollama 模型。</p><Button variant="outline" onClick={() => { setEditing(false); setDialog('choose'); setProviderQuery('') }}><Plus size={16} />添加供应商</Button></div>}
      </div>
    </div>
    {!dialog && feedback}
    <Dialog.Root open={dialog !== null} onOpenChange={open => { if (!open && !isBusy) setDialog(null) }}>
      <Dialog.Portal><Dialog.Overlay className="provider-dialog-overlay" /><Dialog.Content className={`provider-dialog${editing ? ' model-configuration-dialog' : ''}`} onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>('.provider-add')?.focus() }} onEscapeKeyDown={event => { if (isBusy) event.preventDefault() }} onPointerDownOutside={event => { if (isBusy) event.preventDefault() }}>
        <header className="provider-dialog-heading"><Dialog.Title>{dialog === 'choose' ? '添加供应商' : editing ? profile.model : `${providers.includes(profile.provider) ? '连接' : '添加'} · ${providerName(profile.provider)}`}</Dialog.Title>
          {!editing && <div className="provider-steps" aria-label="添加进度"><span data-active={dialog === 'choose'}>1 选择供应商</span><ChevronRight size={13} /><span data-active={dialog === 'configure'}>2 配置连接</span></div>}
          <Dialog.Close asChild><Button variant="ghost" size="icon" disabled={isBusy} aria-label="关闭供应商配置"><X size={18} /></Button></Dialog.Close></header>
        <div className="provider-dialog-body model-settings">
          <Dialog.Description className="provider-dialog-description">{dialog === 'choose' ? '选择要连接的账号或本地服务。' : subscription ? '通过 ChatGPT 订阅账号使用 OpenAI 模型。' : connectingOllama ? '连接本机运行的 Ollama，自动获取已安装的模型。' : `${providerName(profile.provider)} · 此处设置仅用于当前模型。`}</Dialog.Description>
          {dialog === 'choose' ? <>
            <div className="search-field"><Search size={15} /><Input aria-label="搜索供应商" placeholder="搜索供应商…" value={providerQuery} onChange={event => setProviderQuery(event.target.value)} /></div>
            <div className="provider-options">{options.map(provider => <Button variant="ghost" key={provider} onClick={() => configure(provider)}><ProviderIcon provider={provider} /><span><strong>{providerName(provider)}</strong><small>{provider === 'chatgpt' ? '浏览器授权 · 支持复制链接' : '本地运行，连接 Ollama 服务'}</small></span><ChevronRight size={17} /></Button>)}</div>
            {!options.length && <p className="provider-no-results">没有匹配的供应商。目前支持 OpenAI 和 Ollama。</p>}
          </> : subscription ? <div className="provider-subscription"><ChatgptAuthorization onChange={next => { onChange(next); setSelected('chatgpt') }} /></div> : connectingOllama ? <fieldset disabled={isBusy}>
            <Label>本地服务地址<Input type="url" value={ollamaUrl} onChange={event => setOllamaUrl(event.target.value)} placeholder="http://localhost:11434" /></Label><p className="hint">请先启动 Ollama。本步骤只读取模型列表，不会下载或运行模型。</p><Button onClick={() => connectOllama(ollamaUrl, true)} disabled={!ollamaUrl.trim()}>连接并获取模型</Button>
          </fieldset> : <fieldset disabled={isBusy}>
            <ModelProfileFields profile={profile} savedProfile={saved} settings={settings} modelInfo={modelInfo} infoLoading={infoLoading} apiKey={apiKey} removeKey={removeKey} onFieldChange={update} onApiKeyChange={setApiKey} onRemoveKeyChange={remove => { setRemoveKey(remove); setApiKey('') }} />
            {infoError && <p className="error" role="alert">{infoError} <Button size="sm" variant="ghost" disabled={isBusy || infoLoading} onClick={() => setInfoRevision(value => value + 1)}>重试读取</Button></p>}
            <ModelProfileActions isLocal={profile.provider === 'ollama'} hasSavedProfile={Boolean(saved)} deletePending={deletePending} onSave={saveProfile} onSaveAndTest={saveAndTest} onRequestDelete={() => setDeletePending(true)} onConfirmDelete={deleteProfile} onCancelDelete={() => setDeletePending(false)} />
          </fieldset>}
          {feedback}
        </div>
        <footer className="provider-dialog-footer">{editing && saved && <Button variant="ghost" disabled={isBusy || saved.available === false} onClick={() => toggleModel(saved)}>{saved.enabled === false ? '启用此模型' : '停用此模型'}</Button>}{dialog === 'configure' && !editing && <Button variant="ghost" disabled={isBusy} onClick={() => { setDialog('choose'); setError(''); setNotice('') }}><ArrowLeft size={15} />上一步</Button>}<Dialog.Close asChild><Button variant="outline" disabled={isBusy}>{notice ? '完成' : '取消'}</Button></Dialog.Close></footer>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>
}
