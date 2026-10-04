import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ModelProfile, ModelSettings } from '../../shared/models'
import { asRecord, ModelError, parseProfile, parseSaveProfile, profileId } from './model-validation'

export interface CredentialCipher {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}
interface StoredProfile { profile: ModelProfile; encryptedApiKey?: string }
interface SettingsFile { version: 1; activeProfileId: string | null; profiles: StoredProfile[] }

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
      if (raw.version !== 1 || !Array.isArray(raw.profiles) || raw.profiles.length > 20) throw new Error()
      const profiles = raw.profiles.map(value => {
        const entry = asRecord(value)
        if (entry.encryptedApiKey !== undefined && (typeof entry.encryptedApiKey !== 'string' || entry.encryptedApiKey.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.encryptedApiKey))) throw new Error()
        return { profile: parseProfile(entry.profile), encryptedApiKey: entry.encryptedApiKey as string | undefined }
      })
      if (new Set(profiles.map(item => item.profile.id)).size !== profiles.length) throw new Error()
      const activeProfileId = raw.activeProfileId === null ? null : profileId(raw.activeProfileId)
      if (activeProfileId && !profiles.some(item => item.profile.id === activeProfileId)) throw new Error()
      return { version: 1, profiles, activeProfileId }
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
      profiles: settings.profiles.map(item => ({ ...item.profile, hasApiKey: Boolean(item.encryptedApiKey) })) }
  }

  list(): Promise<ModelSettings> { return this.serialized(async () => this.view(await this.read())) }

  save(input: unknown): Promise<ModelSettings> {
    return this.serialized(async () => {
      const { profile, credential } = parseSaveProfile(input)
      const settings = await this.read()
      const existing = settings.profiles.find(item => item.profile.id === profile.id)
      if (!existing && settings.profiles.length >= 20) throw new ModelError('最多保存 20 个模型配置')
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
      await this.write(settings)
      return this.view(settings)
    })
  }

  setActive(id: unknown): Promise<ModelSettings> {
    return this.serialized(async () => {
      const selectedId = profileId(id)
      const settings = await this.read()
      if (!settings.profiles.some(item => item.profile.id === selectedId)) throw new ModelError('模型配置不存在')
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
      if (settings.activeProfileId === selectedId) settings.activeProfileId = settings.profiles[0]?.profile.id ?? null
      await this.write(settings)
      return this.view(settings)
    })
  }

  getForRequest(id: unknown): Promise<{ profile: ModelProfile; apiKey: string }> {
    return this.serialized(async () => {
      const selectedId = profileId(id)
      const entry = (await this.read()).profiles.find(item => item.profile.id === selectedId)
      if (!entry) throw new ModelError('请先保存模型配置')
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
