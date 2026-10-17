import { ipcMain } from 'electron'
import { getApiKey, setApiKey, deleteApiKey } from '../keychain'
import { testOpenAIKey } from '../orchestrator/providers/openai'
import { testAnthropicKey } from '../orchestrator/providers/anthropic'
import { testGoogleKey } from '../orchestrator/providers/google'
import { testOllamaConnection } from '../orchestrator/providers/ollama'
import { detectSubscription } from '../orchestrator/providers/cli'
import { getShellPath } from '../mcp/shellEnv'
import type { KeyProvider, ProviderName, SubscriptionProvider } from '../../shared/types'

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

  ipcMain.handle('ollama:test', async (_, baseUrl: string) => {
    return testOllamaConnection(baseUrl)
  })

  ipcMain.handle('subscription:detect', async (_, provider: SubscriptionProvider) => {
    return detectSubscription(provider, await getShellPath())
  })
}
