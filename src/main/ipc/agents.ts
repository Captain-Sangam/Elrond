import { ipcMain } from 'electron'
import { startDeliberation, cancelDeliberation } from '../orchestrator'
import { listOpenAIModels } from '../orchestrator/providers/openai'
import { listAnthropicModels } from '../orchestrator/providers/anthropic'
import { listGoogleModels } from '../orchestrator/providers/google'
import type { ProviderName, DeliberationRequest } from '../../shared/types'

export function registerAgentsHandlers(): void {
  ipcMain.handle('deliberation:start', async (_, request: DeliberationRequest) => {
    await startDeliberation(request)
  })

  ipcMain.handle('deliberation:cancel', () => {
    cancelDeliberation()
  })

  ipcMain.handle('models:list', async (_, provider: ProviderName, apiKey: string) => {
    switch (provider) {
      case 'openai':
        return listOpenAIModels(apiKey)
      case 'anthropic':
        return listAnthropicModels(apiKey)
      case 'google':
        return listGoogleModels(apiKey)
      default:
        return []
    }
  })
}
