import { BrowserWindow } from 'electron'
import type { ProviderName, ProviderConfig, DeliberationRequest } from '../../shared/types'
import type { AgentProvider, ChatMessage, ContentPart } from './providers/types'
import { loadAttachmentsForMessages, readAttachmentBase64, saveAttachments } from '../attachments'
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { GoogleProvider } from './providers/google'
import {
  getDebateRoundPrompt,
  getModeratorPrompt,
  getSynthesisPrompt,
  parseModeratorVerdict,
  splitDebateResponse,
  type ModeratorVerdict
} from './prompts'
import { getApiKey } from '../keychain'
import { getDb } from '../db'
import { getRepoContext } from '../github'
import { detectAndFetchToolsByFullName, detectRepoFromPrompt, formatToolResults } from '../github/tools'
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
    // Google retires model aliases regularly — make that case actionable
    const retiredMatch = inner.match(/models\/(\S+) is not found/)
    if (retiredMatch) {
      return `Model "${retiredMatch[1]}" is no longer available — pick a new Google model in Settings`
    }
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

// Rough flat estimate per image/PDF part — base64 length wildly overestimates
const ATTACHMENT_TOKEN_ESTIMATE = 1500

function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content)
    } else {
      for (const part of m.content) {
        total += part.type === 'text' ? estimateTokens(part.text) : ATTACHMENT_TOKEN_ESTIMATE
      }
    }
  }
  return total
}

function attachmentToPart(fileName: string, mimeType: string, data: string): ContentPart {
  return mimeType.startsWith('image/')
    ? { type: 'image', mimeType, data }
    : { type: 'file', mimeType, data, fileName }
}

async function streamProvider(
  provider: AgentProvider,
  messages: ChatMessage[],
  model: string,
  providerName: ProviderName,
  phase: 'initial' | 'debate' | 'synthesis',
  signal: AbortSignal,
  round?: number
): Promise<{ content: string; tokenCount: number }> {
  let fullContent = ''

  const apiKey = await getApiKey(providerName)
  if (!apiKey) {
    throw new Error(`No API key configured for ${providerName}`)
  }

  send('stream:start', { provider: providerName, phase, round, inputTokens: estimateMessagesTokens(messages) })

  try {
    for await (const chunk of provider.streamChat(messages, model, apiKey, signal)) {
      if (signal.aborted) break
      fullContent += chunk.delta
      send('stream:token', { provider: providerName, delta: chunk.delta, phase, round })
    }
  } catch (err: unknown) {
    if (signal.aborted) return { content: fullContent, tokenCount: estimateTokens(fullContent) }
    throw err
  }

  const tokenCount = estimateTokens(fullContent)
  send('stream:done', { provider: providerName, fullContent, tokenCount, phase, round })
  return { content: fullContent, tokenCount }
}

// Like streamProvider, but collects the full response without emitting any
// stream events — used for the short moderator verdict call.
async function collectCompletion(
  provider: AgentProvider,
  messages: ChatMessage[],
  model: string,
  providerName: ProviderName,
  signal: AbortSignal
): Promise<string> {
  const apiKey = await getApiKey(providerName)
  if (!apiKey) {
    throw new Error(`No API key configured for ${providerName}`)
  }

  let fullContent = ''
  for await (const chunk of provider.streamChat(messages, model, apiKey, signal)) {
    if (signal.aborted) break
    fullContent += chunk.delta
  }
  return fullContent
}

interface AgentState {
  provider: ProviderConfig
  initial: string
  position: string
  lastCritique: string | null
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
  const maxDebateRounds = Math.min(Math.max(request.maxDebateRounds ?? 3, 1), 5)

  const insertMessage = db.prepare(
    'INSERT INTO messages (id, session_id, role, agent_name, content, token_count, round) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )

  try {
    const activeProviders = providerConfigs.filter((p) => p.enabled)
    if (activeProviders.length === 0) {
      send('stream:error', { provider: 'openai', message: 'No providers enabled' })
      return
    }

    // Build conversation history from prior turns
    const priorMessages = db
      .prepare(
        "SELECT id, role, content FROM messages WHERE session_id = ? AND role IN ('user', 'synthesis') ORDER BY created_at ASC"
      )
      .all(sessionId) as { id: string; role: string; content: string }[]
    const priorAttachments = loadAttachmentsForMessages(
      priorMessages.filter((m) => m.role === 'user').map((m) => m.id)
    )

    // Save user message (with any attached files)
    const userMsgId = uuidv4()
    insertMessage.run(userMsgId, sessionId, 'user', null, prompt, estimateTokens(prompt), 0)
    try {
      saveAttachments(userMsgId, request.attachments ?? [])
    } catch (err) {
      send('stream:error', { provider: activeProviders[0].name, message: cleanErrorMessage(err) })
      return
    }

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
      if (msg.role === 'user') {
        // Re-send stored attachments with their original message so
        // follow-up questions about a file keep working
        const parts: ContentPart[] = [{ type: 'text', text: msg.content }]
        for (const att of priorAttachments.get(msg.id) ?? []) {
          const data = readAttachmentBase64(att)
          if (data) parts.push(attachmentToPart(att.file_name, att.mime_type, data))
        }
        baseMessages.push({ role: 'user', content: parts.length > 1 ? parts : msg.content })
      } else {
        baseMessages.push({ role: 'assistant', content: msg.content })
      }
    }

    const requestAttachments = request.attachments ?? []
    baseMessages.push({
      role: 'user',
      content:
        requestAttachments.length > 0
          ? [
              { type: 'text', text: prompt },
              ...requestAttachments.map((a) => attachmentToPart(a.fileName, a.mimeType, a.data))
            ]
          : prompt
    })

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

        insertMessage.run(uuidv4(), sessionId, 'agent', pc.name, result.content, result.tokenCount, 0)
        initialResults.push({ provider: pc, ...result })
      } catch (err: unknown) {
        if (!signal.aborted) {
          send('stream:error', {
            provider: pc.name,
            message: cleanErrorMessage(err),
            phase: 'initial'
          })
        }
      }
    })

    await Promise.all(fanOutPromises)

    if (signal.aborted || initialResults.length === 0) return

    const agents: AgentState[] = initialResults.map((ir) => ({
      provider: ir.provider,
      initial: ir.content,
      position: ir.content,
      lastCritique: null
    }))
    const roundSummaries: { round: number; disagreements: string[] }[] = []
    const moderatorConfig = activeProviders.find((p) => p.name === synthesizer) || activeProviders[0]

    // Phase 2: Adaptive debate — critique + revise each round, then the
    // moderator judges convergence and decides whether another round runs
    if (enableDebate && agents.length > 1) {
      for (let round = 1; round <= maxDebateRounds; round++) {
        if (signal.aborted) return
        send('stream:phase', { phase: 'debate', round, maxRounds: maxDebateRounds })

        // Snapshot pre-round state so all agents critique the same positions
        const snapshot = agents.map((ag) => ({
          name: ag.provider.name,
          label: PROVIDER_LABELS[ag.provider.name],
          position: ag.position,
          critique: ag.lastCritique
        }))

        let freshCount = 0
        await Promise.all(
          agents.map(async (ag) => {
            try {
              const debatePrompt = getDebateRoundPrompt(
                PROVIDER_LABELS[ag.provider.name],
                round,
                ag.position,
                snapshot
                  .filter((s) => s.name !== ag.provider.name)
                  .map((s) => ({ name: s.label, position: s.position, critique: s.critique }))
              )

              const messages: ChatMessage[] = [
                ...baseMessages,
                { role: 'assistant', content: ag.position },
                { role: 'user', content: debatePrompt }
              ]

              const result = await streamProvider(
                providers[ag.provider.name],
                messages,
                ag.provider.model,
                ag.provider.name,
                'debate',
                signal,
                round
              )
              if (signal.aborted) return

              insertMessage.run(uuidv4(), sessionId, 'debate', ag.provider.name, result.content, result.tokenCount, round)

              const { critique, revised } = splitDebateResponse(result.content)
              ag.position = revised
              ag.lastCritique = critique || null
              freshCount++
            } catch (err: unknown) {
              // Agent drops out of this round but keeps its last position for synthesis
              if (!signal.aborted) {
                send('stream:error', {
                  provider: ag.provider.name,
                  message: cleanErrorMessage(err),
                  phase: 'debate',
                  round
                })
              }
            }
          })
        )

        if (signal.aborted) return

        let verdict: ModeratorVerdict
        let moderatorInputTokens = 0
        let moderatorOutputTokens = 0
        if (freshCount < 2) {
          verdict = {
            converged: true,
            disagreements: [],
            summary: 'Only one agent still responding — ending the debate.'
          }
        } else {
          send('stream:phase', { phase: 'moderating', round, maxRounds: maxDebateRounds })
          const moderatorMessages: ChatMessage[] = [
            {
              role: 'user',
              content: getModeratorPrompt(
                prompt,
                agents.map((ag) => ({ name: PROVIDER_LABELS[ag.provider.name], position: ag.position })),
                round
              )
            }
          ]
          moderatorInputTokens = estimateMessagesTokens(moderatorMessages)
          try {
            const raw = await collectCompletion(
              providers[moderatorConfig.name],
              moderatorMessages,
              moderatorConfig.model,
              moderatorConfig.name,
              signal
            )
            moderatorOutputTokens = estimateTokens(raw)
            verdict = parseModeratorVerdict(raw)
          } catch {
            // A moderator failure must never sink the deliberation — end the
            // debate and proceed to synthesis
            if (signal.aborted) return
            verdict = {
              converged: true,
              disagreements: [],
              summary: 'Moderator unavailable — ending the debate.',
              parseFailed: true
            }
          }
          if (signal.aborted) return
        }

        const verdictJson = JSON.stringify(verdict)
        insertMessage.run(uuidv4(), sessionId, 'moderator', moderatorConfig.name, verdictJson, estimateTokens(verdictJson), round)

        const continuing = !verdict.converged && round < maxDebateRounds
        send('stream:moderator', {
          round,
          maxRounds: maxDebateRounds,
          converged: verdict.converged,
          disagreements: verdict.disagreements,
          summary: verdict.summary,
          continuing,
          inputTokens: moderatorInputTokens,
          outputTokens: moderatorOutputTokens
        })
        roundSummaries.push({ round, disagreements: verdict.disagreements })

        if (!continuing) break
      }
    }

    if (signal.aborted) return

    // Phase 3: Synthesis — always runs so every turn ends with a final answer
    send('stream:phase', { phase: 'synthesis' })

    if (agents.length === 1) {
      // Single agent: its answer is the final answer. Persist it as the
      // synthesis row (no extra API call) so conversation history replay,
      // which only reads user + synthesis rows, keeps working.
      const only = agents[0]
      const tokenCount = estimateTokens(only.position)
      insertMessage.run(uuidv4(), sessionId, 'synthesis', only.provider.name, only.position, tokenCount, 0)
      send('stream:done', {
        provider: only.provider.name,
        fullContent: only.position,
        tokenCount,
        phase: 'synthesis'
      })
    } else {
      const synthesisPrompt = getSynthesisPrompt(
        agents.map((ag) => ({
          name: PROVIDER_LABELS[ag.provider.name],
          initial: ag.initial,
          final: ag.position
        })),
        roundSummaries
      )
      const synthesizerConfig = activeProviders.find((p) => p.name === synthesizer) || activeProviders[0]

      try {
        const synthMessages: ChatMessage[] = [{ role: 'user', content: synthesisPrompt }]

        const result = await streamProvider(
          providers[synthesizerConfig.name],
          synthMessages,
          synthesizerConfig.model,
          synthesizerConfig.name,
          'synthesis',
          signal
        )

        if (!signal.aborted) {
          insertMessage.run(uuidv4(), sessionId, 'synthesis', synthesizerConfig.name, result.content, result.tokenCount, 0)
        }
      } catch (err: unknown) {
        if (!signal.aborted) {
          send('stream:error', {
            provider: synthesizerConfig.name,
            message: cleanErrorMessage(err),
            phase: 'synthesis'
          })
        }
      }
    }
  } finally {
    db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId)
    if (currentAbortController === abortController) {
      currentAbortController = null
    }
    // On abort the renderer ends the deliberation itself; a late 'complete'
    // here could clobber a newer deliberation that superseded this one
    if (!signal.aborted) {
      send('stream:phase', { phase: 'complete' })
    }
  }
}

export function cancelDeliberation(): void {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
}
