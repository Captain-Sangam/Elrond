import { ipcMain } from 'electron'
import { getApiKey, setApiKey, deleteApiKey } from '../keychain'
import { testOpenAIKey } from '../orchestrator/providers/openai'
import { testAnthropicKey } from '../orchestrator/providers/anthropic'
import { testGoogleKey } from '../orchestrator/providers/google'
import type { KeyProvider, ProviderName } from '../../shared/types'

export function registerKeysHandlers(): void {
  ipcMain.handle('keys:get', async (_, provider: KeyProvider) => {
    return getApiKey(provider)
  })

  ipcMain.handle('keys:set', async (_, provider: KeyProvider, key: string) => {
    await setApiKey(provider, key)
  })

  ipcMain.handle('keys:delete', async (_, provider: KeyProvider) => {
    await deleteApiKey(provider)
  })

  ipcMain.handle('keys:test', async (_, provider: ProviderName, key: string) => {
    switch (provider) {
      case 'openai':
        return testOpenAIKey(key)
      case 'anthropic':
        return testAnthropicKey(key)
      case 'google':
        return testGoogleKey(key)
      default:
        return false
    }
  })
}
