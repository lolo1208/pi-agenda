// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/renderer/src/App'
import type { PiConsoleApi } from '../src/shared/api'
import { readPreferences } from '../src/renderer/src/preferences'
afterEach(() => { cleanup(); localStorage.clear(); delete document.documentElement.dataset.theme })
function setup() {
  window.piConsole = {
    getModelSettings: async () => ({ ok: true, value: { profiles: [{ id: 'test', name: '测试模型', model: 'test-model' }], activeProfileId: 'test', encryptionAvailable: true } }),
    chatWithModel: async () => ({ ok: true, value: { text: '测试回复', model: 'test-model', elapsedMs: 10 } })
  } as unknown as PiConsoleApi
  render(<App />)
  return userEvent.setup()
}
describe('工作台', () => {
  it('在任务之间保留消息和草稿，并可搜索任务', async () => {
    const user = setup()
    await screen.findByText('test-model')
    await user.type(screen.getByLabelText('消息'), '第一项任务')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('测试回复', { selector: 'p' })
    await user.type(screen.getByLabelText('消息'), '未发送的草稿')
    await user.click(screen.getByRole('button', { name: '新建任务' }))
    expect((screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: /第一项任务.*测试回复/ }))
    expect((screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement).value).toBe('未发送的草稿')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    await user.type(screen.getByLabelText('搜索任务'), '不存在')
    expect(screen.getByText('没有找到匹配的任务')).toBeTruthy()
  })
  it('右栏默认收起；设置主题后返回仍保留输入', async () => {
    const user = setup()
    expect(screen.queryByRole('region', { name: '侧栏工具' })).toBeNull()
    await user.type(screen.getByLabelText('消息'), '保留我')
    await user.click(screen.getByRole('button', { name: '展开工具栏' }))
    const tools = screen.getByRole('region', { name: '侧栏工具' })
    await user.click(within(tools).getByRole('button', { name: '终端' }))
    expect(within(tools).getByText('待实现')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /设置.*v0.1/ }))
    await user.click(screen.getByRole('button', { name: '外观' }))
    await user.click(screen.getByRole('button', { name: '暗色' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(readPreferences().theme).toBe('dark')
    await user.click(screen.getByRole('button', { name: '设置' }))
    expect((screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement).value).toBe('保留我')
  })
  it('请求期间允许切换任务，但阻止第二个请求；取消后保留草稿', async () => {
    const user = setup()
    let finish!: (value: Awaited<ReturnType<PiConsoleApi['chatWithModel']>>) => void
    window.piConsole.chatWithModel = (() => new Promise(resolve => { finish = resolve })) as PiConsoleApi['chatWithModel']
    window.piConsole.cancelModelRequest = async () => {
      finish({ ok: false, error: '模型请求已取消' })
      return { ok: true, value: undefined }
    }
    await screen.findByText('test-model')
    await user.type(screen.getByLabelText('消息'), '请求中的草稿')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await user.click(screen.getByRole('button', { name: '新建任务' }))
    await user.type(screen.getByRole('textbox', { name: '消息' }), '第二个任务')
    expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(true)
    const taskButtons = screen.getAllByRole('button', { name: /新建任务.*开始一段新的对话/ })
    await user.click(taskButtons[1])
    await user.click(screen.getByRole('button', { name: '取消请求' }))
    await screen.findByRole('alert')
    expect((screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement).value).toBe('请求中的草稿')
  })
  it('无效的本地偏好恢复默认值', () => {
    localStorage.setItem('pi-console.preferences', '{broken')
    expect(readPreferences()).toEqual({ theme: 'light', inlineDiff: false, sendWithCtrlEnter: true, font: 'inter', fontSize: 14 })
  })
})
