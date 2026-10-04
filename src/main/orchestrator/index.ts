import { BrowserWindow } from 'electron'
import type { ProviderName } from '../../shared/types'
import { loadAttachmentsForMessages, readAttachmentBase64, saveAttachments } from '../attachments'
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { GoogleProvider } from './providers/google'
import { OllamaProvider } from './providers/ollama'
import { getApiKey } from '../keychain'
import { getOllamaBaseUrl } from '../agentStore'
import { getDb } from '../db'
import { getRepoContext } from '../github'
import { formatWebResults, searchWeb } from '../websearch'
import { detectAndFetchToolsByFullName, detectRepoFromPrompt, formatToolResults } from '../github/tools'
import { callTool, listAllTools } from '../mcp/manager'
import { createDeliberationRunner } from './runner'

// Cloud providers authenticate from the keychain; ollama is keyless and gets
// its server base URL instead
async function resolveCredential(providerName: ProviderName): Promise<string> {
  if (providerName === 'ollama') {
    return getOllamaBaseUrl()
  }
  const apiKey = await getApiKey(providerName)
  if (!apiKey) {
    throw new Error(`No API key configured for ${providerName}`)
  }
  return apiKey
}

const runner = createDeliberationRunner({
  getDb,
  send: (channel, data) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) win.webContents.send(channel, data)
  },
  providers: {
    openai: new OpenAIProvider(),
    anthropic: new AnthropicProvider(),
    google: new GoogleProvider(),
    ollama: new OllamaProvider()
  },
  resolveCredential,
  loadAttachmentsForMessages, readAttachmentBase64, saveAttachments,
  detectRepoFromPrompt, getRepoContext,
  getGitHubContext: async (name, prompt) => formatToolResults(await detectAndFetchToolsByFullName(name, prompt)),
  getWebContext: async (prompt) => formatWebResults(await searchWeb(prompt)),
  callTool, listAllTools
})

export const startDeliberation = runner.startDeliberation
export const cancelDeliberation = runner.cancelDeliberation
