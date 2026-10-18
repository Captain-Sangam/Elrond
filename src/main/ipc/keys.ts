import { ipcMain } from 'electron'
import { getApiKey, setApiKey, deleteApiKey } from '../keychain'
import { testOpenAIKey } from '../orchestrator/providers/openai'
import { testAnthropicKey } from '../orchestrator/providers/anthropic'
import { testGoogleKey } from '../orchestrator/providers/google'
import { testOllamaConnection } from '../orchestrator/providers/ollama'
import {
  checkCliMcpServer,
  detectSubscription,
  getClaudeUsage,
  listCliMcpServers,
  readCodexUsage
} from '../orchestrator/providers/cli'
import { getShellPath } from '../mcp/shellEnv'
import type { CliMcpServer, KeyProvider, ProviderName, SubscriptionProvider } from '../../shared/types'

// Listing Claude's servers health-checks each one (~30s), so keep the
// result for the app run; the picker's Refresh re-lists
const cliMcpServerCache = new Map<SubscriptionProvider, Promise<CliMcpServer[]>>()

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

  ipcMain.handle('subscription:usage', async (_, provider: SubscriptionProvider) => {
    return provider === 'anthropic' ? getClaudeUsage() : readCodexUsage(await getShellPath())
  })

  ipcMain.handle('subscription:mcpServers', async (_, provider: SubscriptionProvider, refresh?: boolean) => {
    if (refresh || !cliMcpServerCache.has(provider)) {
      cliMcpServerCache.set(provider, listCliMcpServers(provider, await getShellPath()))
    }
    return cliMcpServerCache.get(provider)
  })

  ipcMain.handle('subscription:mcpCheck', async (_, provider: SubscriptionProvider, name: string) => {
    const server = await checkCliMcpServer(provider, name, await getShellPath())
    // Keep the cached list current so reopening the chooser shows the new status
    const cached = cliMcpServerCache.get(provider)
    if (cached) cliMcpServerCache.set(provider, cached.then((list) => list.map((s) => (s.name === name ? server : s))))
    return server
  })
}
