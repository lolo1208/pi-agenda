import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PROVIDER_PRESETS, type ModelProfile, type ModelProfileView, type ModelSettings, type ProviderId } from '../../../shared/models'

interface ModelProfileFieldsProps {
  profile: ModelProfile
  savedProfile: ModelProfileView | undefined
  settings: ModelSettings
  apiKey: string
  removeKey: boolean
  onFieldChange: <Key extends keyof ModelProfile>(field: Key, value: ModelProfile[Key]) => void
  onProviderChange: (provider: ProviderId) => void
  onApiKeyChange: (value: string) => void
  onRemoveKeyChange: (remove: boolean) => void
}

export function ModelProfileFields({ profile, savedProfile, settings, apiKey, removeKey, onFieldChange, onProviderChange, onApiKeyChange, onRemoveKeyChange }: ModelProfileFieldsProps): React.JSX.Element {
  return <>
    <Label>配置名称<Input value={profile.name} maxLength={80} onChange={event => onFieldChange('name', event.target.value)} /></Label>
    <Label>服务商<Select value={profile.provider} onValueChange={value => onProviderChange(value as ProviderId)}>
      <SelectTrigger aria-label="服务商"><SelectValue /></SelectTrigger>
      <SelectContent>{PROVIDER_PRESETS.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
    </Select></Label>
    <Label>协议<Select value={profile.protocol} onValueChange={value => onFieldChange('protocol', value as ModelProfile['protocol'])}>
      <SelectTrigger aria-label="协议"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="openai-compatible">OpenAI 兼容 · Chat Completions</SelectItem>
        <SelectItem value="anthropic">Claude · Messages</SelectItem>
      </SelectContent>
    </Select></Label>
    <Label>Base URL<Input type="url" value={profile.baseUrl} placeholder="https://your-service.example/v1" onChange={event => onFieldChange('baseUrl', event.target.value)} /></Label>
    <p className="hint">填写 API 根地址，自含 /chat/completions 或 /messages。远程使用 HTTPS，本机支持 HTTP。</p>
    <Label>模型 ID<Input value={profile.model} maxLength={200} placeholder="服务端的模型名称" onChange={event => onFieldChange('model', event.target.value)} /></Label>
    <Label>API Key {savedProfile?.hasApiKey ? '· 已加密保存' : '· 未配置'}<Input type="password" value={apiKey} autoComplete="off" spellCheck={false} disabled={!settings.encryptionAvailable || removeKey}
      placeholder={savedProfile?.hasApiKey ? '留空保留现有密钥；输入新值进行替换' : '本地无认证服务可留空'} onChange={event => onApiKeyChange(event.target.value)} /></Label>
    {savedProfile?.hasApiKey && <Label className="checkbox-label"><Checkbox checked={removeKey} onCheckedChange={checked => onRemoveKeyChange(checked === true)} />保存时删除已存 API Key</Label>}
    <div className="form-grid">
      <Label>Temperature（留空由服务决定）<Input type="number" min="0" max={profile.protocol === 'anthropic' ? 1 : 2} step="0.1" value={profile.temperature ?? ''}
        onChange={event => onFieldChange('temperature', event.target.value === '' ? null : Number(event.target.value))} /></Label>
      <Label>输出 Token 上限<Input type="number" min="1" max="131072" value={profile.maxTokens} onChange={event => onFieldChange('maxTokens', Number(event.target.value))} /></Label>
      <Label>超时（秒）<Input type="number" min="5" max="300" value={profile.timeoutSeconds} onChange={event => onFieldChange('timeoutSeconds', Number(event.target.value))} /></Label>
      {profile.protocol === 'openai-compatible' && <Label>Token 参数<Select value={profile.tokenParameter} onValueChange={value => onFieldChange('tokenParameter', value as ModelProfile['tokenParameter'])}>
        <SelectTrigger aria-label="Token 参数"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem><SelectItem value="max_tokens">max_tokens</SelectItem></SelectContent>
      </Select></Label>}
    </div>
    <p className="hint">部分模型自支持 Temperature，留空即可省略。参数支持和 Token 上限以服务端为准。</p>
  </>
}
