import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { ModelSettingsStore, type CredentialCipher } from '../src/main/models/model-settings-store'
import { normalizeBaseUrl, parseMessages } from '../src/main/models/model-validation'
import type { ModelProfile } from '../src/shared/models'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
export const profile: ModelProfile = {
  id: 'test-profile', name: 'Test', provider: 'openai', protocol: 'openai-compatible', baseUrl: 'https://example.com/v1',
  model: 'test-model', temperature: null, maxTokens: 1024, tokenParameter: 'max_completion_tokens', timeoutSeconds: 5
}
async function setup(): Promise<{ store: ModelSettingsStore; file: string; cipher: CredentialCipher }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-console-models-')); roots.push(root)
  const file = path.join(root, 'model-settings.json')
  const encryptionKey = randomBytes(32)
  // Real test encryption; production uses Electron safeStorage. No OS vault claims from this fixture.
  const cipher: CredentialCipher = {
    isAvailable: () => true,
    encrypt(value) {
      const iv = randomBytes(12); const encoder = createCipheriv('aes-256-gcm', encryptionKey, iv)
      const bytes = Buffer.concat([encoder.update(value, 'utf8'), encoder.final()])
      return Buffer.concat([iv, encoder.getAuthTag(), bytes])
    },
    decrypt(value) {
      const decoder = createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0, 12))
      decoder.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decoder.update(value.subarray(28)), decoder.final()]).toString('utf8')
    }
  }
  return { file, cipher, store: new ModelSettingsStore(file, cipher) }
}
describe('ModelSettingsStore', () => {
  it('encrypts credentials, never returns them to UI, and reopens persisted profiles', async () => {
    const { store, file, cipher } = await setup()
    const apiKey = 'sk-fixture-private-value'
    const saved = await store.save({ profile, credential: { action: 'replace', value: apiKey } })
    expect(JSON.stringify(saved)).not.toContain(apiKey)
    expect(saved.profiles[0].hasApiKey).toBe(true)
    expect(await readFile(file, 'utf8')).not.toContain(apiKey)
    const reopened = new ModelSettingsStore(file, cipher)
    expect((await reopened.list()).activeProfileId).toBe(profile.id)
    expect((await reopened.getForRequest(profile.id)).apiKey).toBe(apiKey)
    await reopened.save({ profile: { ...profile, name: 'Renamed' }, credential: { action: 'keep' } })
    expect((await reopened.getForRequest(profile.id)).apiKey).toBe(apiKey)
    await reopened.save({ profile, credential: { action: 'replace', value: 'replacement-key' } })
    expect((await reopened.getForRequest(profile.id)).apiKey).toBe('replacement-key')
    await reopened.save({ profile, credential: { action: 'remove' } })
    expect((await reopened.list()).profiles[0].hasApiKey).toBe(false)
    await expect(reopened.getForRequest(profile.id)).rejects.toThrow('API Key')
    await reopened.delete(profile.id)
    expect((await reopened.list()).profiles).toEqual([])
  })
  it('does not silently forward saved credentials when endpoint or protocol changes', async () => {
    const { store } = await setup()
    await store.save({ profile, credential: { action: 'replace', value: 'test-key' } })
    for (const changed of [{ ...profile, baseUrl: 'https://other.example/v1' }, { ...profile, protocol: 'anthropic' }]) {
      await expect(store.save({ profile: changed, credential: { action: 'keep' } })).rejects.toThrow('重新输入')
    }
    expect((await store.list()).profiles[0].baseUrl).toBe(profile.baseUrl)
  })
  it('refuses plaintext fallback but allows a keyless local model', async () => {
    const { file, cipher } = await setup()
    const store = new ModelSettingsStore(file, { ...cipher, isAvailable: () => false })
    await expect(store.save({ profile, credential: { action: 'replace', value: 'secret' } })).rejects.toThrow('不会以明文保存')
    await store.save({ profile: { ...profile, provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }, credential: { action: 'keep' } })
    expect((await store.getForRequest(profile.id)).apiKey).toBe('')
  })
  it('serializes writes and persists active selection', async () => {
    const { store } = await setup()
    await Promise.all(['first', 'second'].map(id => store.save({ profile: { ...profile, id }, credential: { action: 'keep' } })))
    expect((await store.list()).profiles).toHaveLength(2)
    await store.setActive('second')
    expect((await store.list()).activeProfileId).toBe('second')
    await store.delete('second')
    expect((await store.list()).activeProfileId).toBe('first')
  })
  it('does not overwrite corrupt settings or expose their contents in errors', async () => {
    const { store, file } = await setup()
    const original = '{"secret":"do-not-echo"'
    await writeFile(file, original)
    await expect(store.save({ profile, credential: { action: 'keep' } })).rejects.toThrow('配置损坏')
    expect(await readFile(file, 'utf8')).toBe(original)
  })
})
describe('Model input boundaries', () => {
  it.each(['http://remote.example/v1', 'file:///tmp/test', 'https://user:secret@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1/chat/completions'])('rejects unsafe or incorrect endpoint %s', url => {
    expect(() => normalizeBaseUrl(url)).toThrow()
  })
  it('accepts normalized HTTPS and loopback URLs', () => {
    expect(normalizeBaseUrl('https://example.com/v1/')).toBe('https://example.com/v1')
    expect(normalizeBaseUrl('http://[::1]:8000/v1')).toBe('http://[::1]:8000/v1')
  })
  it('rejects injected system/tool messages and oversized input', () => {
    expect(() => parseMessages([{ role: 'system', content: 'test' }])).toThrow()
    expect(() => parseMessages([{ role: 'user', content: 'x'.repeat(32001) }])).toThrow()
    expect(() => parseMessages([{ role: 'assistant', content: 'test' }])).toThrow()
  })
})
