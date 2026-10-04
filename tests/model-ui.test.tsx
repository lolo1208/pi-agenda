// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModelSettingsPanel from '../src/renderer/src/ModelSettingsPanel'
import ModelChat from '../src/renderer/src/ModelChat'
import type { ModelProfileView, ModelReply, ModelResult, ModelSettings, SaveModelProfile } from '../src/shared/models'
import type { PiConsoleApi } from '../src/shared/api'

const profile: ModelProfileView = {
  id: 'ui-profile', name: '本地测试', provider: 'ollama', protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1',
  model: 'local-model', temperature: null, maxTokens: 1024, tokenParameter: 'max_tokens', timeoutSeconds: 30, hasApiKey: false
}
const settings: ModelSettings = { activeProfileId: profile.id, encryptionAvailable: true, profiles: [profile] }
afterEach(cleanup)
function setApi(api: Partial<PiConsoleApi>): void { window.piConsole = api as PiConsoleApi }

describe('Model settings UI', () => {
  it('saves a typed key once and clears the password input after saving', async () => {
    const user = userEvent.setup()
    const saveModelProfile = vi.fn(async (input: SaveModelProfile): Promise<ModelResult<ModelSettings>> => ({
      ok: true, value: { ...settings, profiles: [{ ...input.profile, hasApiKey: input.credential.action === 'replace' }] }
    }))
    setApi({ saveModelProfile })
    function Harness() {
      const [state, setState] = useState(settings)
      return <ModelSettingsPanel settings={state} onChange={setState} onClose={() => undefined} />
    }
    render(<Harness />)
    await user.type(screen.getByLabelText(/^API Key/), 'typed-test-secret')
    await user.click(screen.getByRole('button', { name: '保存配置' }))
    await screen.findByText('配置已保存')
    expect(saveModelProfile.mock.calls[0][0].credential).toEqual({ action: 'replace', value: 'typed-test-secret' })
    expect((screen.getByLabelText(/^API Key/) as HTMLInputElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(saveModelProfile).toHaveBeenCalledTimes(2))
    expect(saveModelProfile.mock.calls[1][0].credential).toEqual({ action: 'keep' })
  })

  it('allows cancelling a pending connection test and does not announce success', async () => {
    const user = userEvent.setup()
    let finish: (result: ModelResult<ModelReply>) => void = () => undefined
    const testModel = vi.fn<PiConsoleApi['testModel']>(() => new Promise<ModelResult<ModelReply>>(resolve => { finish = resolve }))
    const cancelModelRequest = vi.fn<PiConsoleApi['cancelModelRequest']>(async (): Promise<ModelResult<void>> => {
      finish({ ok: false, error: '模型请求已取消' }); return { ok: true, value: undefined }
    })
    setApi({ saveModelProfile: async () => ({ ok: true, value: settings }), testModel, cancelModelRequest })
    render(<ModelSettingsPanel settings={settings} onChange={() => undefined} onClose={() => undefined} />)
    await user.click(screen.getByRole('button', { name: '保存并测试连接' }))
    await user.click(await screen.findByRole('button', { name: '取消连接测试' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('已取消')
    expect(cancelModelRequest.mock.calls[0]).toEqual([testModel.mock.calls[0][1]])
    expect(screen.queryByText(/连接成功/)).toBeNull()
  })
})

describe('Model chat UI', () => {
  it('sends visible history, preserves failed input and excludes failures from history', async () => {
    const user = userEvent.setup()
    const chatWithModel = vi.fn<PiConsoleApi['chatWithModel']>()
      .mockResolvedValueOnce({ ok: true, value: { text: '第一轮回答', elapsedMs: 1, model: profile.model, truncated: false } })
      .mockResolvedValueOnce({ ok: false, error: '模型请求超时' })
      .mockResolvedValueOnce({ ok: true, value: { text: '第二轮回答', elapsedMs: 2, model: profile.model, truncated: false } })
    setApi({ chatWithModel })
    render(<ModelChat profile={profile} onBusyChange={() => undefined} onOpenSettings={() => undefined} />)
    const input = screen.getByLabelText('消息') as HTMLTextAreaElement
    await user.type(input, '第一轮')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('第一轮回答')
    expect(input.value).toBe('')
    await user.type(input, '第二轮')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByRole('alert')
    expect(input.value).toBe('第二轮')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('第二轮回答')
    expect(chatWithModel.mock.calls[2][2]).toEqual([
      { role: 'user', content: '第一轮' }, { role: 'assistant', content: '第一轮回答' }, { role: 'user', content: '第二轮' }
    ])
  })
})
