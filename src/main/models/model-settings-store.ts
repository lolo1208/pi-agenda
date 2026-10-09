import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ModelDescriptor, ModelProfile, ModelProviderConnection, ModelSettings } from '../../shared/models'
import { asRecord, ModelError, normalizeOllamaUrl, parseProfile, parseSaveProfile, profileId, requiredString } from './model-validation'

export interface CredentialCipher {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}
interface StoredProfile { profile: ModelProfile; encryptedApiKey?: string }
interface SettingsFile { version: 1; activeProfileId: string | null; profiles: StoredProfile[]; providers?: ModelProviderConnection[] }

export class ModelSettingsStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly filePath: string, private readonly cipher: CredentialCipher) {}

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async read(): Promise<SettingsFile> {
    let text: string
    try { text = await readFile(this.filePath, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, activeProfileId: null, profiles: [] }
      throw new ModelError('无法读取模型配置，请检查应用数据目录权限')
    }
    try {
      const raw = asRecord(JSON.parse(text))
      if (raw.version !== 1 || !Array.isArray(raw.profiles) || raw.profiles.length > 200) throw new Error()
      const profiles = raw.profiles.map(value => {
        const entry = asRecord(value)
        if (entry.encryptedApiKey !== undefined && (typeof entry.encryptedApiKey !== 'string' || entry.encryptedApiKey.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.encryptedApiKey))) throw new Error()
        return { profile: parseProfile(entry.profile), encryptedApiKey: entry.encryptedApiKey as string | undefined }
      })
      if (new Set(profiles.map(item => item.profile.id)).size !== profiles.length) throw new Error()
      const activeProfileId = raw.activeProfileId === null ? null : profileId(raw.activeProfileId)
      if (activeProfileId && !profiles.some(item => item.profile.id === activeProfileId)) throw new Error()
      const providers: ModelProviderConnection[] = []
      if (raw.providers !== undefined) {
        if (!Array.isArray(raw.providers) || raw.providers.length > 20) throw new Error()
        for (const value of raw.providers) {
          const entry = asRecord(value)
          if (entry.provider !== 'ollama' || !Array.isArray(entry.models) || entry.models.length > 200) throw new Error()
          const models: ModelDescriptor[] = entry.models.map(value => {
            const model = asRecord(value)
            if (!Array.isArray(model.capabilities) || model.capabilities.some(item => typeof item !== 'string')) throw new Error()
            if (model.maxContextTokens !== null && (typeof model.maxContextTokens !== 'number' || !Number.isSafeInteger(model.maxContextTokens) || model.maxContextTokens <= 0)) throw new Error()
            return { id: requiredString(model.id, '模型名称', 200), capabilities: model.capabilities as string[], maxContextTokens: model.maxContextTokens as number | null,
              sizeBytes: typeof model.sizeBytes === 'number' ? model.sizeBytes : undefined, parameterSize: typeof model.parameterSize === 'string' ? model.parameterSize : undefined,
              quantization: typeof model.quantization === 'string' ? model.quantization : undefined }
          })
          providers.push({ provider: 'ollama', baseUrl: normalizeOllamaUrl(entry.baseUrl), models })
        }
      }
      const settings = { version: 1 as const, profiles, activeProfileId, providers }
      this.reconcileActive(settings)
      return settings
    } catch { throw new ModelError('模型配置损坏或版本不支持，已停止读取；请备份应用数据后检查 model-settings.json') }
  }

  private async write(settings: SettingsFile): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await writeFile(temporaryPath, JSON.stringify(settings, null, 2), { mode: 0o600, flag: 'wx' })
      await rename(temporaryPath, this.filePath)
    } catch { throw new ModelError('模型配置保存失败，请检查应用数据目录权限') }
    finally { await rm(temporaryPath, { force: true }).catch(() => undefined) }
  }

  private view(settings: SettingsFile): ModelSettings {
    return { activeProfileId: settings.activeProfileId, encryptionAvailable: this.cipher.isAvailable(),
      providers: settings.providers ?? [],
      profiles: settings.profiles.map(item => ({ ...item.profile, hasApiKey: Boolean(item.encryptedApiKey), available: this.available(settings, item.profile) })) }
  }
  private available(settings: SettingsFile, profile: ModelProfile): boolean {
    const connection = settings.providers?.find(item => item.provider === profile.provider && item.baseUrl === profile.baseUrl)
    return !connection || connection.models.some(item => item.id === profile.model)
  }
  private reconcileActive(settings: SettingsFile): void {
    const usable = settings.profiles.filter(item => item.profile.enabled !== false && this.available(settings, item.profile))
    if (!usable.some(item => item.profile.id === settings.activeProfileId)) settings.activeProfileId = usable[0]?.profile.id ?? null
  }

  syncOllama(baseUrl: unknown, models: ModelDescriptor[]): Promise<ModelSettings> {
    return this.serialized(async () => {
      const root = normalizeOllamaUrl(baseUrl)
      const settings = await this.read()
      for (const model of models) {
        if (settings.profiles.some(item => item.profile.provider === 'ollama' && item.profile.baseUrl === root && item.profile.model === model.id)) continue
        settings.profiles.push({ profile: { id: randomUUID(), name: model.id, provider: 'ollama', protocol: 'openai-compatible', baseUrl: root,
          model: model.id, temperature: null, contextTokens: null, enabled: true, maxTokens: 2048, tokenParameter: 'max_tokens', timeoutSeconds: 120 } })
      }
      if (settings.profiles.length > 200) throw new ModelError('最多保存 200 个模型配置，请先删除不用的配置')
      const connection: ModelProviderConnection = { provider: 'ollama', baseUrl: root, models }
      settings.providers = [...(settings.providers ?? []).filter(item => item.provider !== 'ollama'), connection]
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  list(): Promise<ModelSettings> { return this.serialized(async () => this.view(await this.read())) }

  save(input: unknown): Promise<ModelSettings> {
    return this.serialized(async () => {
      const { profile, credential } = parseSaveProfile(input)
      const settings = await this.read()
      const existing = settings.profiles.find(item => item.profile.id === profile.id)
      if (!existing && settings.profiles.length >= 200) throw new ModelError('最多保存 200 个模型配置')
      const descriptor = settings.providers?.find(item => item.provider === profile.provider && item.baseUrl === profile.baseUrl)?.models.find(item => item.id === profile.model)
      if (descriptor?.maxContextTokens && profile.contextTokens && profile.contextTokens > descriptor.maxContextTokens) throw new ModelError('上下文上限不能超过模型支持的最大上下文')
      let encryptedApiKey = existing?.encryptedApiKey
      if (credential.action === 'keep' && encryptedApiKey && (existing?.profile.baseUrl !== profile.baseUrl || existing.profile.protocol !== profile.protocol)) throw new ModelError('服务地址或协议已改变，请重新输入对应 API Key，或选择删除密钥后保存')
      if (credential.action === 'remove') encryptedApiKey = undefined
      if (credential.action === 'replace') {
        if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法保存 API Key；不会以明文保存')
        try { encryptedApiKey = this.cipher.encrypt(credential.value!).toString('base64') }
        catch { throw new ModelError('API Key 加密失败，原配置未更改') }
      }
      const entry = { profile, encryptedApiKey }
      settings.profiles = existing ? settings.profiles.map(item => item.profile.id === profile.id ? entry : item) : [...settings.profiles, entry]
      settings.activeProfileId ??= profile.id
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  setActive(id: unknown): Promise<ModelSettings> {
    return this.serialized(async () => {
      const selectedId = profileId(id)
      const settings = await this.read()
      const entry = settings.profiles.find(item => item.profile.id === selectedId)
      if (!entry) throw new ModelError('模型配置不存在')
      if (entry.profile.enabled === false || !this.available(settings, entry.profile)) throw new ModelError('该模型已停用或不在本地服务中，请先启用或刷新模型列表')
      settings.activeProfileId = selectedId
      await this.write(settings)
      return this.view(settings)
    })
  }

  delete(id: unknown): Promise<ModelSettings> {
    return this.serialized(async () => {
      const selectedId = profileId(id)
      const settings = await this.read()
      settings.profiles = settings.profiles.filter(item => item.profile.id !== selectedId)
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  getForRequest(id: unknown): Promise<{ profile: ModelProfile; apiKey: string }> {
    return this.serialized(async () => {
      const selectedId = profileId(id)
      const settings = await this.read()
      const entry = settings.profiles.find(item => item.profile.id === selectedId)
      if (!entry) throw new ModelError('请先保存模型配置')
      if (entry.profile.enabled === false || !this.available(settings, entry.profile)) throw new ModelError('该模型已停用或不可用，请在模型设置中启用或刷新模型列表')
      let apiKey = ''
      if (entry.encryptedApiKey) {
        if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法读取 API Key')
        try { apiKey = this.cipher.decrypt(Buffer.from(entry.encryptedApiKey, 'base64')) }
        catch { throw new ModelError('API Key 解密失败，请在设置中重新输入密钥') }
      }
      if (!apiKey && ['openai', 'anthropic', 'deepseek'].includes(entry.profile.provider)) throw new ModelError('请先保存该服务的 API Key')
      return { profile: entry.profile, apiKey }
    })
  }
}
