export type InterfaceFont = 'inter' | 'system' | 'segoe' | 'yahei'
import { MAX_CUSTOM_PROMPT_LENGTH } from '../../shared/models'
export interface Preferences { theme: 'light' | 'dark'; inlineDiff: boolean; sendWithCtrlEnter: boolean; font: InterfaceFont; fontSize: number; customPrompt: string }
export const defaultPreferences: Preferences = { theme: 'light', inlineDiff: false, sendWithCtrlEnter: true, font: 'inter', fontSize: 14, customPrompt: '' }
export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('pi-agenda.preferences') ?? '{}')
    const fontSize = Number(value?.fontSize)
    return {
      theme: value?.theme === 'dark' ? 'dark' : 'light',
      inlineDiff: value?.inlineDiff === true,
      // Preferences saved before the shortcut existed should receive the new enabled default once.
      sendWithCtrlEnter: value?.sendWithCtrlEnterVersion === 1 ? value?.sendWithCtrlEnter !== false : true,
      font: ['inter', 'system', 'segoe', 'yahei'].includes(value?.font) ? value.font : 'inter',
      fontSize: Number.isFinite(fontSize) ? Math.max(12, Math.min(20, fontSize)) : 14,
      customPrompt: typeof value?.customPrompt === 'string' ? value.customPrompt.slice(0, MAX_CUSTOM_PROMPT_LENGTH) : ''
    }
  } catch { return defaultPreferences }
}
