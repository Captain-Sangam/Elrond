import { ipcMain } from 'electron'
import { startDeliberation, cancelDeliberation } from '../orchestrator'
import { listOpenAIModels } from '../orchestrator/providers/openai'
import { listAnthropicModels } from '../orchestrator/providers/anthropic'
import { listGoogleModels } from '../orchestrator/providers/google'
import { listOllamaModels } from '../orchestrator/providers/ollama'
import { getAgents, getOllamaBaseUrl, saveAgents } from '../agentStore'
import type { AgentConfig, ProviderName, DeliberationRequest } from '../../shared/types'

export function registerAgentsHandlers(): void {
  ipcMain.handle('deliberation:start', async (_, request: DeliberationRequest) => {
    await startDeliberation(request)
  })

  ipcMain.handle('deliberation:cancel', () => {
    cancelDeliberation()
  })

  ipcMain.handle('agents:list', () => {
    return getAgents()
  })

  ipcMain.handle('agents:save', (_, agents: AgentConfig[]) => {
    saveAgents(agents)
  })

  // credential = API key for cloud providers, optional base-URL override for ollama
  ipcMain.handle('models:list', async (_, provider: ProviderName, credential?: string) => {
    switch (provider) {
      case 'openai':
        return listOpenAIModels(credential ?? '')
      case 'anthropic':
        return listAnthropicModels(credential ?? '')
      case 'google':
        return listGoogleModels(credential ?? '')
      case 'ollama':
        return listOllamaModels(credential || getOllamaBaseUrl())
      default:
        return []
    }
  })
}
