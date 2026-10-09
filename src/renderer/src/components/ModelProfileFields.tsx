import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ModelDescriptor, ModelProfile, ModelProfileView, ModelSettings } from '../../../shared/models'

interface ModelProfileFieldsProps {
  profile: ModelProfile
  savedProfile: ModelProfileView | undefined
  settings: ModelSettings
  modelInfo?: ModelDescriptor | null
  infoLoading?: boolean
  apiKey: string
  removeKey: boolean
  onFieldChange: <Key extends keyof ModelProfile>(field: Key, value: ModelProfile[Key]) => void
  onApiKeyChange: (value: string) => void
  onRemoveKeyChange: (remove: boolean) => void
}
const capabilityLabels: Record<string, string> = { completion: '文本生成', vision: '图片输入', tools: '工具调用', thinking: '推理', embedding: '向量嵌入' }
export function ModelProfileFields({ profile, savedProfile, settings, modelInfo, infoLoading, apiKey, removeKey, onFieldChange, onApiKeyChange, onRemoveKeyChange }: ModelProfileFieldsProps): React.JSX.Element {
  const local = profile.provider === 'ollama'
  return <div className="model-configuration-grid">
    <div className="model-configuration-fields">
      <h4>模型参数</h4>
      <Label>显示名称<Input value={profile.name} maxLength={80} onChange={event => onFieldChange('name', event.target.value)} /></Label>
      <Label>上下文上限（tokens）<Input type="number" min="1" max={Math.min(modelInfo?.maxContextTokens ?? 2097152, 2097152)} step="1" value={profile.contextTokens ?? ''} placeholder="使用服务默认值" onChange={event => onFieldChange('contextTokens', event.target.value === '' ? null : Number(event.target.value))} /></Label>
      <p className="hint">{local ? '留空使用 Ollama 默认值；此设置会应用到该模型的每次请求。上下文包含输入与输出。' : '按模型独立保存；上下文参数将在供应商支持后应用到请求。'}</p>
      {profile.contextTokens != null && modelInfo?.maxContextTokens != null && profile.contextTokens > modelInfo.maxContextTokens && <p className="error">设置超过模型支持的最大上下文。</p>}
      <Label>输出 Token 上限<Input type="number" min="1" max={Math.min(profile.contextTokens ?? 131072, 131072)} value={profile.maxTokens} onChange={event => onFieldChange('maxTokens', Number(event.target.value))} /></Label>
      <Label>Temperature（留空由服务决定）<Input type="number" min="0" max={profile.protocol === 'anthropic' ? 1 : 2} step="0.1" value={profile.temperature ?? ''} onChange={event => onFieldChange('temperature', event.target.value === '' ? null : Number(event.target.value))} /></Label>
      <Label>超时（秒）<Input type="number" min="5" max="300" value={profile.timeoutSeconds} onChange={event => onFieldChange('timeoutSeconds', Number(event.target.value))} /></Label>
      {local && (modelInfo?.capabilities.includes('thinking') || profile.thinking != null) && <Label>推理模式<Select value={profile.thinking == null ? 'default' : profile.thinking ? 'on' : 'off'} onValueChange={value => onFieldChange('thinking', value === 'default' ? null : value === 'on')}><SelectTrigger aria-label="推理模式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">使用模型默认值</SelectItem><SelectItem value="on">开启推理</SelectItem><SelectItem value="off">关闭推理</SelectItem></SelectContent></Select></Label>}
      <Button type="button" variant="ghost" size="sm" className="model-reset" onClick={() => { onFieldChange('contextTokens', null); onFieldChange('temperature', null); onFieldChange('thinking', null); onFieldChange('maxTokens', 2048); onFieldChange('timeoutSeconds', local ? 120 : 60) }}>恢复默认参数</Button>
      {!local && <details className="provider-advanced"><summary>连接与认证</summary>
        <Label>Base URL<Input type="url" value={profile.baseUrl} onChange={event => onFieldChange('baseUrl', event.target.value)} /></Label>
        <Label>模型 ID<Input value={profile.model} maxLength={200} onChange={event => onFieldChange('model', event.target.value)} /></Label>
        {!settings.encryptionAvailable && <p className="error" role="status">系统安全存储不可用，暂时不能保存或读取 API Key。</p>}
        <Label>API Key {savedProfile?.hasApiKey ? '· 已加密保存' : '· 未配置'}<Input type="password" value={apiKey} autoComplete="off" spellCheck={false} disabled={!settings.encryptionAvailable || removeKey} placeholder={savedProfile?.hasApiKey ? '留空保留现有密钥' : '输入服务密钥'} onChange={event => onApiKeyChange(event.target.value)} /></Label>
        {savedProfile?.hasApiKey && <Label className="checkbox-label"><Checkbox checked={removeKey} onCheckedChange={checked => onRemoveKeyChange(checked === true)} />保存时删除已存 API Key</Label>}
        {profile.protocol === 'openai-compatible' && <Label>Token 参数<Select value={profile.tokenParameter} onValueChange={value => onFieldChange('tokenParameter', value as ModelProfile['tokenParameter'])}><SelectTrigger aria-label="Token 参数"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem><SelectItem value="max_tokens">max_tokens</SelectItem></SelectContent></Select></Label>}
      </details>}
    </div>
    <aside className="model-specifications" aria-label="模型信息">
      <h4>能力</h4>
      {infoLoading && <p className="hint" role="status">正在读取模型信息…</p>}
      <dl><div><dt>输入类型</dt><dd>{modelInfo ? modelInfo.capabilities.includes('vision') ? '文字 · 图片' : modelInfo.capabilities.includes('completion') || modelInfo.capabilities.includes('embedding') ? '文字' : '未提供' : '未提供'}</dd></div>
        <div><dt>输出类型</dt><dd>{modelInfo ? modelInfo.capabilities.includes('completion') ? '文字' : modelInfo.capabilities.includes('embedding') ? '向量' : '未提供' : '未提供'}</dd></div>
        <div><dt>支持能力</dt><dd>{modelInfo?.capabilities.length ? modelInfo.capabilities.map(value => capabilityLabels[value] ?? value).join('、') : '服务未提供'}</dd></div>
      </dl>
      {modelInfo?.capabilities.includes('vision') && <p className="hint">模型支持图片输入，当前对话界面仅发送文字。</p>}
      <h4>规格</h4><dl>
        <div><dt>最大上下文</dt><dd>{modelInfo?.maxContextTokens?.toLocaleString() ?? '未提供'}{modelInfo?.maxContextTokens ? ' tokens' : ''}</dd></div>
        <div><dt>参数规模</dt><dd>{modelInfo?.parameterSize ?? '未提供'}</dd></div>
        <div><dt>量化</dt><dd>{modelInfo?.quantization ?? '未提供'}</dd></div>
        {modelInfo?.sizeBytes != null && <div><dt>模型大小</dt><dd>{(modelInfo.sizeBytes / 1024 ** 3).toFixed(2)} GiB</dd></div>}
      </dl>
      <h4>模型信息</h4><dl><div><dt>模型 ID</dt><dd>{profile.model}</dd></div><div><dt>供应商</dt><dd>{local ? 'Ollama' : profile.provider}</dd></div><div><dt>服务地址</dt><dd>{profile.baseUrl}</dd></div></dl>
      {local && <p className="hint">能力与规格来自 Ollama。可用上下文还取决于本机内存和服务配置。</p>}
    </aside>
  </div>
}
