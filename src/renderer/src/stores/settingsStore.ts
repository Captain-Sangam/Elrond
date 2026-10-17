import { create } from 'zustand'
import type { AuthMode, SubscriptionProvider } from '@shared/types'

interface SettingsState {
  setupComplete: boolean
  enableDebate: boolean
  maxDebateRounds: number
  globalShortcut: string
  submitKey: 'Enter' | 'CmdEnter'
  systemPrompt: string
  // API key vs CLI subscription per provider — read by the auth switch, the
  // agents dialog and the cost estimate, so it must update via setSetting
  authModes: Record<SubscriptionProvider, AuthMode>
  loaded: boolean

  loadSettings: () => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  setupComplete: false,
  enableDebate: true,
  maxDebateRounds: 3,
  globalShortcut: 'Control+Shift+Space',
  submitKey: 'CmdEnter',
  systemPrompt: '',
  authModes: { anthropic: 'api', openai: 'api' },
  loaded: false,

  loadSettings: async () => {
    const settings = await window.elrond.getAllSettings()

    set({
      setupComplete: settings.setupComplete === 'true',
      enableDebate: settings.enableDebate !== 'false',
      maxDebateRounds: parseInt(settings.maxDebateRounds || '3', 10) || 3,
      globalShortcut: settings.globalShortcut || 'Control+Shift+Space',
      submitKey: (settings.submitKey as 'Enter' | 'CmdEnter') || 'CmdEnter',
      systemPrompt: settings.systemPrompt || '',
      authModes: {
        anthropic: settings.anthropic_auth === 'subscription' ? 'subscription' : 'api',
        openai: settings.openai_auth === 'subscription' ? 'subscription' : 'api'
      },
      loaded: true
    })
  },

  setSetting: async (key: string, value: string) => {
    await window.elrond.setSetting(key, value)

    switch (key) {
      case 'setupComplete':
        set({ setupComplete: value === 'true' })
        break
      case 'enableDebate':
        set({ enableDebate: value === 'true' })
        break
      case 'maxDebateRounds':
        set({ maxDebateRounds: parseInt(value, 10) || 3 })
        break
      case 'globalShortcut':
        set({ globalShortcut: value })
        break
      case 'submitKey':
        set({ submitKey: value as 'Enter' | 'CmdEnter' })
        break
      case 'systemPrompt':
        set({ systemPrompt: value })
        break
      case 'anthropic_auth':
      case 'openai_auth':
        set((state) => ({
          authModes: { ...state.authModes, [key.replace('_auth', '')]: value as AuthMode }
        }))
        break
    }
  }
}))
