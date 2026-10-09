import { useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, ChevronDown, Cpu, LayoutGrid, Plus, Search, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PROVIDER_PRESETS, type ModelProfileView, type ProviderId } from '../../../../shared/models'

interface Props {
  profile?: ModelProfileView
  profiles: ModelProfileView[]
  disabled?: boolean
  onSelect(id: string): void
  onOpenSettings(): void
}

export function ConversationModelPicker({ profile, profiles, disabled, onSelect, onOpenSettings }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const providers = PROVIDER_PRESETS.filter(item => profiles.some(model => model.provider === item.id))
  const search = query.trim().toLocaleLowerCase()
  const filtered = profiles.filter(item => (search || !provider || item.provider === provider)
    && `${item.name} ${item.model} ${PROVIDER_PRESETS.find(preset => preset.id === item.provider)?.label ?? ''}`.toLocaleLowerCase().includes(search))
  const close = (): void => setOpen(false)

  return <Popover.Root open={open && !disabled} onOpenChange={next => {
    setOpen(next)
    if (next) { setQuery(''); setProvider(profile?.provider ?? null) }
  }}>
    <Popover.Trigger asChild>
      <Button type="button" className="model-picker" disabled={disabled} aria-label={`切换模型：${profile?.model || '选择模型'}`} title="切换本次会话的模型">
        {profile?.provider === 'ollama' ? <Server size={14} /> : <Cpu size={14} />}<span>{profile?.model || '选择模型'}</span><ChevronDown size={14} />
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="conversation-model-picker" side="top" align="end" sideOffset={10} collisionPadding={12} aria-label="本次会话模型">
        <div className="conversation-model-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索会话模型" placeholder="搜索模型…" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="conversation-model-body">
          <nav className="conversation-model-providers" aria-label="模型供应商">
            <Button type="button" variant="ghost" aria-label="全部模型" title="全部模型" aria-pressed={!provider} onClick={() => { setProvider(null); setQuery('') }}><LayoutGrid size={17} /></Button>
            {providers.map(item => <Button key={item.id} type="button" variant="ghost" title={item.label} aria-label={`${item.label} 模型`} aria-pressed={provider === item.id} onClick={() => { setProvider(item.id); setQuery('') }}>
              {item.id === 'ollama' ? <Server size={17} /> : <Cpu size={17} />}
            </Button>)}
          </nav>
          <div className="conversation-model-list">
            {providers.map(item => {
              const models = filtered.filter(model => model.provider === item.id)
              if (!models.length) return null
              return <section key={item.id} aria-label={item.label}>
                <h2>{item.label}</h2>
                {models.map(model => <Button type="button" variant="ghost" className="conversation-model-option" key={model.id} aria-label={`使用 ${model.name}`} aria-pressed={model.id === profile?.id} disabled={model.enabled === false || model.available === false} onClick={() => { onSelect(model.id); close() }}>
                  {item.id === 'ollama' ? <Server size={16} /> : <Cpu size={16} />}
                  <span className="conversation-model-details"><strong>{model.name}{model.available === false ? ' · 本地未找到' : model.enabled === false ? ' · 已停用' : ''}</strong></span>
                  {model.id === profile?.id && <Check size={16} aria-hidden="true" />}
                </Button>)}
              </section>
            })}
            {!filtered.length && <p className="conversation-model-empty">{profiles.length ? '没有找到匹配的模型，请尝试其他名称。' : '尚未配置模型，请先添加供应商。'}</p>}
          </div>
        </div>
        <footer><Button type="button" variant="ghost" onClick={() => { close(); onOpenSettings() }}><Plus size={15} />配置模型</Button></footer>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
