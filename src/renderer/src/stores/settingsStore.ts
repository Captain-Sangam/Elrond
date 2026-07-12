import { create } from 'zustand'
import type { ProviderName, ProviderConfig } from '@shared/types'

interface SettingsState {
  setupComplete: boolean
  providers: ProviderConfig[]
  synthesizer: ProviderName
  enableDebate: boolean
  maxDebateRounds: number
  globalShortcut: string
  submitKey: 'Enter' | 'CmdEnter'
  systemPrompt: string
  loaded: boolean

  loadSettings: () => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
  setProvider: (name: ProviderName, updates: Partial<ProviderConfig>) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  setupComplete: false,
  providers: [
    { name: 'openai', label: 'OpenAI', model: 'gpt-4o', enabled: true },
    { name: 'anthropic', label: 'Anthropic', model: 'claude-sonnet-4-5-20250514', enabled: true },
    { name: 'google', label: 'Google', model: 'gemini-pro-latest', enabled: true }
  ],
  synthesizer: 'anthropic',
  enableDebate: true,
  maxDebateRounds: 3,
  globalShortcut: 'CommandOrControl+Shift+Space',
  submitKey: 'CmdEnter',
  systemPrompt: '',
  loaded: false,

  loadSettings: async () => {
    const settings = await window.elrond.getAllSettings()

    const providers = get().providers.map((p) => ({
      ...p,
      model: settings[`${p.name}_model`] || p.model
    }))

    set({
      setupComplete: settings.setupComplete === 'true',
      providers,
      synthesizer: (settings.synthesizer as ProviderName) || 'anthropic',
      enableDebate: settings.enableDebate !== 'false',
      maxDebateRounds: parseInt(settings.maxDebateRounds || '3', 10) || 3,
      globalShortcut: settings.globalShortcut || 'CommandOrControl+Shift+Space',
      submitKey: (settings.submitKey as 'Enter' | 'CmdEnter') || 'CmdEnter',
      systemPrompt: settings.systemPrompt || '',
      loaded: true
    })
  },

  setSetting: async (key: string, value: string) => {
    await window.elrond.setSetting(key, value)

    switch (key) {
      case 'setupComplete':
        set({ setupComplete: value === 'true' })
        break
      case 'synthesizer':
        set({ synthesizer: value as ProviderName })
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
    }

    if (key.endsWith('_model')) {
      const providerName = key.replace('_model', '') as ProviderName
      const providers = get().providers.map((p) =>
        p.name === providerName ? { ...p, model: value } : p
      )
      set({ providers })
    }
  },

  setProvider: (name, updates) => {
    const providers = get().providers.map((p) =>
      p.name === name ? { ...p, ...updates } : p
    )
    set({ providers })
  }
}))
