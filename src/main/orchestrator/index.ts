import { BrowserWindow } from 'electron'
import type { ProviderName, ProviderConfig, DeliberationRequest } from '../../shared/types'
import type { AgentProvider, ChatMessage } from './providers/types'
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { GoogleProvider } from './providers/google'
import { getDebatePrompt, getSynthesisPrompt } from './prompts'
import { getApiKey } from '../keychain'
import { getDb } from '../db'
import { getRepoContext } from '../github'
import { detectAndFetchTools, detectAndFetchToolsByFullName, detectRepoFromPrompt, formatToolResults } from '../github/tools'
import { v4 as uuidv4 } from 'uuid'

const providers: Record<ProviderName, AgentProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  google: new GoogleProvider()
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google'
}

let currentAbortController: AbortController | null = null

function cleanErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error'
  const raw = err.message

  // Anthropic: "404 {"type":"error","error":{"type":"not_found_error","message":"model: ..."}}"
  try {
    const jsonStart = raw.indexOf('{')
    if (jsonStart !== -1) {
      const parsed = JSON.parse(raw.slice(jsonStart))
      if (parsed?.error?.message) return parsed.error.message
    }
  } catch {
    // not JSON, fall through
  }

  // Google: "[GoogleGenerativeAI Error]: Error fetching from ... [429 Too Many Requests] ..."
  const googleMatch = raw.match(/\[GoogleGenerativeAI Error\]:\s*(.+?)(?:\s*https?:\/\/\S+)?$/s)
  if (googleMatch) {
    const inner = googleMatch[1]
    const statusMatch = inner.match(/\[(\d+ .+?)\]/)
    if (statusMatch) return statusMatch[1]
    return inner.slice(0, 120)
  }

  // Truncate very long messages
  if (raw.length > 150) return raw.slice(0, 150) + '...'
  return raw
}

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows[0] || null
}

function send(channel: string, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

async function streamProvider(
  provider: AgentProvider,
  messages: ChatMessage[],
  model: string,
  providerName: ProviderName,
  phase: 'initial' | 'debate' | 'synthesis',
  signal: AbortSignal
): Promise<{ content: string; tokenCount: number }> {
  let fullContent = ''

  const apiKey = await getApiKey(providerName)
  if (!apiKey) {
    throw new Error(`No API key configured for ${providerName}`)
  }

  try {
    for await (const chunk of provider.streamChat(messages, model, apiKey, signal)) {
      if (signal.aborted) break
      fullContent += chunk.delta
      send('stream:token', { provider: providerName, delta: chunk.delta, phase })
    }
  } catch (err: unknown) {
    if (signal.aborted) return { content: fullContent, tokenCount: estimateTokens(fullContent) }
    throw err
  }

  const tokenCount = estimateTokens(fullContent)
  send('stream:done', { provider: providerName, fullContent, tokenCount, phase })
  return { content: fullContent, tokenCount }
}

export async function startDeliberation(request: DeliberationRequest): Promise<void> {
  cancelDeliberation()

  const abortController = new AbortController()
  currentAbortController = abortController
  const { signal } = abortController

  const db = getDb()
  const {
    sessionId,
    prompt,
    providers: providerConfigs,
    enableDebate,
    synthesizer,
    systemPrompt,
    repoId,
    repoFullName
  } = request

  const activeProviders = providerConfigs.filter((p) => p.enabled)
  if (activeProviders.length === 0) {
    send('stream:error', { provider: 'openai', message: 'No providers enabled' })
    return
  }

  // Build conversation history from prior rounds
  const priorMessages = db
    .prepare(
      "SELECT role, content FROM messages WHERE session_id = ? AND role IN ('user', 'synthesis') ORDER BY created_at ASC"
    )
    .all(sessionId) as { role: string; content: string }[]

  // Save user message
  const userMsgId = uuidv4()
  db.prepare(
    'INSERT INTO messages (id, session_id, role, agent_name, content, token_count) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userMsgId, sessionId, 'user', null, prompt, estimateTokens(prompt))

  const baseMessages: ChatMessage[] = []

  // Resolve repo: slash command > session repo > auto-detect from prompt
  let resolvedFullName: string | null = repoFullName || null
  let resolvedIndexedId: string | null = null

  if (resolvedFullName) {
    const indexed = db.prepare('SELECT id FROM indexed_repos WHERE full_name = ?').get(resolvedFullName) as
      | { id: string }
      | undefined
    resolvedIndexedId = indexed?.id || null
  } else if (repoId) {
    const repoInfo = db.prepare('SELECT full_name FROM indexed_repos WHERE id = ?').get(repoId) as
      | { full_name: string }
      | undefined
    if (repoInfo) {
      resolvedFullName = repoInfo.full_name
      resolvedIndexedId = repoId
    }
  }

  if (!resolvedFullName) {
    const detected = detectRepoFromPrompt(prompt)
    if (detected) {
      resolvedFullName = detected.fullName
      resolvedIndexedId = detected.indexedRepoId
    }
  }

  // Build system prompt with optional repo context + live GitHub data
  let fullSystemPrompt = systemPrompt || ''
  if (resolvedFullName) {
    let contextSections = ''

    // Fetch live GitHub data (PRs, commits, issues, etc.) based on the prompt
    send('stream:phase', { phase: 'fetching_context' })
    try {
      const toolResults = await detectAndFetchToolsByFullName(resolvedFullName, prompt)
      const toolContext = formatToolResults(toolResults)
      if (toolContext) contextSections += toolContext
    } catch {
      // GitHub API may fail for repos the token can't access — continue without
    }

    // Search indexed code if repo is indexed locally
    if (resolvedIndexedId) {
      const codeContext = getRepoContext(resolvedIndexedId, prompt)
      if (codeContext) contextSections += `\n## Repository Code\n${codeContext}`
    }

    fullSystemPrompt = `You are a code assistant with full access to the repository "${resolvedFullName}". You have access to the repository's pull requests, commits, issues, and other GitHub data${resolvedIndexedId ? ', as well as the indexed source code' : ''}. Use all available context to give thorough, specific answers. Reference PR numbers, commit SHAs, file paths, and line numbers when relevant.\n\n${contextSections}\n\n${fullSystemPrompt}`
  }

  if (fullSystemPrompt) {
    baseMessages.push({ role: 'system', content: fullSystemPrompt })
  }
  for (const msg of priorMessages) {
    baseMessages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })
  }
  baseMessages.push({ role: 'user', content: prompt })

  // Phase 1: Fan-out
  send('stream:phase', { phase: 'initial' })

  const initialResults: { provider: ProviderConfig; content: string; tokenCount: number }[] = []

  const fanOutPromises = activeProviders.map(async (pc) => {
    try {
      const result = await streamProvider(
        providers[pc.name],
        baseMessages,
        pc.model,
        pc.name,
        'initial',
        signal
      )

      const msgId = uuidv4()
      db.prepare(
        'INSERT INTO messages (id, session_id, role, agent_name, content, token_count) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(msgId, sessionId, 'agent', pc.name, result.content, result.tokenCount)

      initialResults.push({ provider: pc, ...result })
    } catch (err: unknown) {
      if (!signal.aborted) {
        send('stream:error', {
          provider: pc.name,
          message: cleanErrorMessage(err)
        })
      }
    }
  })

  await Promise.all(fanOutPromises)

  if (signal.aborted || initialResults.length === 0) return

  // Phase 2: Debate
  if (enableDebate && initialResults.length > 1) {
    send('stream:phase', { phase: 'debate' })

    const debateResults: { provider: ProviderConfig; content: string }[] = []

    const debatePromises = initialResults.map(async (ir) => {
      try {
        const otherResponses = initialResults
          .filter((other) => other.provider.name !== ir.provider.name)
          .map((other) => ({
            name: PROVIDER_LABELS[other.provider.name],
            content: other.content
          }))

        const debatePrompt = getDebatePrompt(
          PROVIDER_LABELS[ir.provider.name],
          otherResponses
        )

        const messages: ChatMessage[] = [
          ...baseMessages,
          { role: 'assistant', content: ir.content },
          { role: 'user', content: debatePrompt }
        ]

        const result = await streamProvider(
          providers[ir.provider.name],
          messages,
          ir.provider.model,
          ir.provider.name,
          'debate',
          signal
        )

        const msgId = uuidv4()
        db.prepare(
          'INSERT INTO messages (id, session_id, role, agent_name, content, token_count) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(msgId, sessionId, 'debate', ir.provider.name, result.content, result.tokenCount)

        debateResults.push({ provider: ir.provider, content: result.content })
      } catch (err: unknown) {
        if (!signal.aborted) {
          send('stream:error', {
            provider: ir.provider.name,
            message: cleanErrorMessage(err)
          })
        }
      }
    })

    await Promise.all(debatePromises)

    if (signal.aborted) return

    // Phase 3: Synthesis
    send('stream:phase', { phase: 'synthesis' })

    const allResponses = initialResults.map((ir) => {
      const debate = debateResults.find(
        (dr) => dr.provider.name === ir.provider.name
      )
      return {
        name: PROVIDER_LABELS[ir.provider.name],
        initial: ir.content,
        debate: debate?.content || '(No debate response)'
      }
    })

    const synthesisPrompt = getSynthesisPrompt(allResponses)
    const synthesizerConfig = activeProviders.find((p) => p.name === synthesizer) || activeProviders[0]

    try {
      const synthMessages: ChatMessage[] = [
        { role: 'user', content: synthesisPrompt }
      ]

      const result = await streamProvider(
        providers[synthesizerConfig.name],
        synthMessages,
        synthesizerConfig.model,
        synthesizerConfig.name,
        'synthesis',
        signal
      )

      const msgId = uuidv4()
      db.prepare(
        'INSERT INTO messages (id, session_id, role, agent_name, content, token_count) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(msgId, sessionId, 'synthesis', synthesizerConfig.name, result.content, result.tokenCount)
    } catch (err: unknown) {
      if (!signal.aborted) {
        send('stream:error', {
          provider: synthesizerConfig.name,
          message: cleanErrorMessage(err)
        })
      }
    }
  }

  // Update session timestamp
  db.prepare('UPDATE sessions SET updated_at = datetime(\'now\') WHERE id = ?').run(sessionId)

  currentAbortController = null
}

export function cancelDeliberation(): void {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
}
