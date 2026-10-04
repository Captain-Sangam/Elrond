import type Database from 'better-sqlite3'
import type { AgentConfig, ProviderName, DeliberationRequest, Attachment, AttachmentPayload, DebateIssue, TerminationReason, ToolResult, MCPToolInfo } from '../../shared/types'
import type { AgentProvider, ChatMessage, ContentPart } from './providers/types'
import * as defaultPrompts from './prompts'
import type { ModeratorVerdict, DebateResponse } from './prompts'
import { buildNamespacedTools, runToolLoop, type NamespacedTools, type McpBridge } from './toolLoop'
import { attachmentToPart, cleanErrorMessage, estimateTokens } from './utils'
import { v4 as uuidv4 } from 'uuid'

export interface ProviderCallRecord {
  callId: string
  agentId: string
  model: string
  provider: ProviderName
  phase: 'initial' | 'debate' | 'moderator' | 'synthesis'
  round: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  error?: string
}

export interface DeliberationRuntime {
  getDb: () => Database.Database
  send: (channel: string, data: unknown) => void
  providers: Record<ProviderName, AgentProvider>
  resolveCredential: (provider: ProviderName) => Promise<string>
  loadAttachmentsForMessages?: (ids: string[]) => Map<string, Attachment[]>
  readAttachmentBase64?: (attachment: Attachment) => string | null
  saveAttachments?: (id: string, attachments: AttachmentPayload[]) => unknown
  detectRepoFromPrompt?: (prompt: string) => { fullName: string; indexedRepoId: string | null } | null
  getRepoContext?: (id: string, prompt: string) => string
  getGitHubContext?: (name: string, prompt: string) => Promise<string>
  getWebContext?: (prompt: string) => Promise<string>
  listAllTools?: () => Promise<{ serverId: string; serverName: string; tool: MCPToolInfo }[]>
  callTool?: McpBridge['callTool']
  onCall?: (call: ProviderCallRecord) => void
  // Used only by the benchmark's frozen 7fe4439 prompt adapter. The app never sets these.
  prompts?: Pick<typeof defaultPrompts, 'getDebateRoundPrompt' | 'getModeratorPrompt' | 'getSynthesisPrompt' | 'parseModeratorVerdict' | 'splitDebateResponse'>
  legacyDebate?: boolean
}

export function createDeliberationRunner(runtime: DeliberationRuntime): {
  startDeliberation: (request: DeliberationRequest) => Promise<void>
  cancelDeliberation: () => void
} {
  const { getDb, send, providers, resolveCredential } = runtime
  const { getDebateRoundPrompt, getModeratorPrompt, getSynthesisPrompt, parseModeratorVerdict, splitDebateResponse } = runtime.prompts ?? defaultPrompts
  const loadAttachmentsForMessages = runtime.loadAttachmentsForMessages ?? (() => new Map<string, Attachment[]>())
  const readAttachmentBase64 = runtime.readAttachmentBase64 ?? (() => null)
  const saveAttachments = runtime.saveAttachments ?? ((_id: string, attachments: AttachmentPayload[]) => {
    if (attachments.length) throw new Error('Attachments unavailable in this runtime')
  })
  const detectRepoFromPrompt = runtime.detectRepoFromPrompt ?? (() => null)
  const getRepoContext = runtime.getRepoContext ?? (() => '')
  let currentAbortController: AbortController | null = null

  async function streamAgent(
    agent: AgentConfig,
    messages: ChatMessage[],
    phase: 'initial' | 'debate' | 'synthesis',
    signal: AbortSignal,
    round?: number,
    mcpTools?: NamespacedTools | null
  ): Promise<{ content: string; tokenCount: number; toolResults: ToolResult[] }> {
    const credential = await resolveCredential(agent.provider)
    const ident = { agentId: agent.id, agentName: agent.name, provider: agent.provider }

    // Synthesis merges already-debated positions — introducing new un-debated
    // facts there would bypass the deliberation, so tools stay off
    const withTools = !!mcpTools && mcpTools.tools.length > 0 && phase !== 'synthesis'

    let callId = ''
    const result = await runToolLoop({
      provider: providers[agent.provider],
      messages,
      model: agent.model,
      credential,
      signal,
      tools: withTools ? mcpTools!.tools : undefined,
      toolIndex: withTools ? mcpTools!.toolIndex : undefined,
      mcp: withTools ? { callTool: runtime.callTool! } : undefined,
      onText: (delta) => send('stream:token', { ...ident, delta, phase, round }),
      onTool: (event) => send('stream:tool', { ...ident, phase, round, ...event }),
      onNotice: (message) => send('stream:notice', { message: `${agent.name}: ${message}` }),
      onIterationStart: (_msgs, _sequence, inputTokens) => {
        callId = uuidv4()
        send('stream:start', { ...ident, phase, round, callId, inputTokens, estimated: true })
      },
      onIterationEnd: (usage) => runtime.onCall?.({ ...usage, callId, agentId: agent.id, model: agent.model, provider: agent.provider, phase, round: round ?? 0 })
    })

    if (!runtime.legacyDebate && !signal.aborted && !result.content.trim()) throw new Error('Model returned an empty answer')
    const tokenCount = result.outputTokens
    if (!signal.aborted && phase !== 'debate') {
      send('stream:done', { ...ident, fullContent: result.content, tokenCount, phase, round, toolResults: result.toolResults })
    }
    return { content: result.content, tokenCount, toolResults: result.toolResults }
  }

  // Like streamAgent, but collects the full response without emitting any
  // stream events — used for the short moderator verdict call.
  async function collectCompletion(
    agent: AgentConfig,
    messages: ChatMessage[],
    signal: AbortSignal,
    round: number,
    onUsage: (input: number, output: number) => void
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const credential = await resolveCredential(agent.provider)
    const callId = uuidv4()
    return runToolLoop({
      provider: providers[agent.provider], messages, model: agent.model, credential, signal,
      onText: () => {},
      onIterationEnd: (usage) => {
        onUsage(usage.inputTokens, usage.outputTokens)
        runtime.onCall?.({ ...usage, callId, agentId: agent.id, model: agent.model, provider: agent.provider, phase: 'moderator', round })
      }
    })
  }

  interface AgentState {
    agent: AgentConfig
    initial: string
    position: string
    lastCritique: string | null
  }

  async function startDeliberation(request: DeliberationRequest): Promise<void> {
    cancelDeliberation()

    const abortController = new AbortController()
    currentAbortController = abortController
    const { signal } = abortController

    const db = getDb()
    const {
      sessionId,
      prompt,
      agents: agentConfigs,
      enableDebate,
      synthesizerAgentId,
      systemPrompt,
      repoId,
      repoFullName
    } = request
    const maxDebateRounds = Math.min(Math.max(request.maxDebateRounds ?? 3, 1), 5)

    let terminationReason: TerminationReason = 'degraded'
    let userMsgId: string | null = null
    const insertMessage = db.prepare(
      'INSERT INTO messages (id, session_id, role, agent_name, agent_id, provider, content, token_count, round, tool_results) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const insertAgentMessage = (role: string, agent: AgentConfig, content: string, tokenCount: number, round: number, toolResults: ToolResult[] = []): void => {
      insertMessage.run(uuidv4(), sessionId, role, agent.name, agent.id, agent.provider, content, tokenCount, round, toolResults.length ? JSON.stringify(toolResults) : null)
    }

    try {
      const activeAgents = (agentConfigs ?? []).filter((a) => a.enabled)
      if (activeAgents.length === 0) {
        send('stream:notice', { message: 'No agents enabled — enable at least one agent in the Agents dialog.' })
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
      userMsgId = uuidv4()
      insertMessage.run(userMsgId, sessionId, 'user', null, null, null, prompt, estimateTokens(prompt), 0, null)
      try {
        saveAttachments(userMsgId, request.attachments ?? [])
      } catch (err) {
        send('stream:notice', { message: `Failed to save attachments: ${cleanErrorMessage(err)}` })
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
          const toolContext = await runtime.getGitHubContext?.(resolvedFullName, prompt) ?? ''
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

      // Web search (globe toggle) — non-fatal: a failed search must never sink
      // the deliberation, it just proceeds without the extra context
      if (request.webSearch) {
        send('stream:phase', { phase: 'searching_web' })
        try {
          const webContext = await runtime.getWebContext?.(prompt.slice(0, 400)) ?? ''
          if (webContext) {
            fullSystemPrompt = `${webContext}\n\n${fullSystemPrompt}`
          } else {
            send('stream:notice', { message: 'Web search returned no results — continuing without.' })
          }
        } catch (err) {
          send('stream:notice', {
            message: `Web search skipped: ${err instanceof Error ? err.message : 'unknown error'}`
          })
        }
      }

      // MCP tools — non-fatal like web search: agents deliberate without tools
      // if no server is connected or the manager fails. The renderer's plug
      // toggle sends an explicit false to keep tools out of unrelated chats.
      let mcpTools: NamespacedTools | null = null
      if (request.mcpTools !== false) {
        try {
          const allTools = await runtime.listAllTools?.() ?? []
          if (allTools.length > 0) {
            mcpTools = buildNamespacedTools(allTools)
            // Small models over-trigger on tools and let the mere mention of a
            // service bleed into answers — the policy must make own-knowledge the
            // default, say what the tools are NOT, and ban unprompted mentions
            const serverNames = [...new Set(allTools.map((t) => t.serverName))].join(', ')
            fullSystemPrompt =
              `${fullSystemPrompt}\n\nTool policy: you have function tools from these connected services: ${serverNames}. They expose only that service's own data (issues, documents, files) — they are not a search engine and know nothing about the wider world. Default to answering from your own knowledge. Call a tool only when the user explicitly asks about one of these services or data stored in them. If tool output does not answer the question, say so and answer from your own knowledge. Never mention these services, the tools, or tool mechanics unless the user asked about them.`.trim()
          }
        } catch (err) {
          send('stream:notice', { message: `MCP tools unavailable: ${cleanErrorMessage(err)}` })
        }
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

      const initialResults: { agent: AgentConfig; content: string; tokenCount: number }[] = []

      const fanOutPromises = activeAgents.map(async (agent) => {
        try {
          const result = await streamAgent(agent, baseMessages, 'initial', signal, undefined, mcpTools)

          insertAgentMessage('agent', agent, result.content, result.tokenCount, 0, result.toolResults)
          initialResults.push({ agent, ...result })
        } catch (err: unknown) {
          if (!signal.aborted) {
            send('stream:error', {
              agentId: agent.id,
              agentName: agent.name,
              provider: agent.provider,
              message: cleanErrorMessage(err),
              phase: 'initial'
            })
          }
        }
      })

      await Promise.all(fanOutPromises)

      if (signal.aborted || initialResults.length === 0) return

      const agents: AgentState[] = initialResults.map((ir) => ({
        agent: ir.agent,
        initial: ir.content,
        position: ir.content,
        lastCritique: null
      }))
      const roundSummaries: { round: number; disagreements: string[]; terminationReason?: string | null }[] = []
      let openIssues: DebateIssue[] = []
      const issueHistory: DebateIssue[] = []
      terminationReason = initialResults.length < activeAgents.length ? 'degraded' : enableDebate ? 'single_agent' : 'not_requested'
      // The synthesizer agent also moderates debates; fall back to the first
      // enabled agent when it's disabled or was deleted
      const synthesizerAgent =
        activeAgents.find((a) => a.id === synthesizerAgentId) || activeAgents[0]

      // Phase 2: Adaptive debate — critique + revise each round, then the
      // moderator judges convergence and decides whether another round runs
      if (enableDebate && agents.length > 1) {
        for (let round = 1; round <= maxDebateRounds; round++) {
          if (signal.aborted) return
          send('stream:phase', { phase: 'debate', round, maxRounds: maxDebateRounds })

          // Snapshot pre-round state so all agents critique the same positions
          const snapshot = agents.map((ag) => ({
            id: ag.agent.id,
            name: ag.agent.name,
            position: ag.position,
            critique: ag.lastCritique
          }))

          let freshCount = 0
          let unchangedCount = 0
          const reports: { name: string; status?: DebateResponse['status'] }[] = []
          await Promise.all(
            agents.map(async (ag) => {
              try {
                const debatePrompt = getDebateRoundPrompt(
                  ag.agent.name,
                  round,
                  ag.position,
                  // Opponents are everyone but this agent — filtered by id, so
                  // two agents on the same provider still see each other
                  snapshot
                    .filter((s) => s.id !== ag.agent.id)
                    .map((s) => ({ name: s.name, position: s.position, critique: s.critique })),
                  openIssues
                )

                const messages: ChatMessage[] = [
                  ...baseMessages,
                  { role: 'assistant', content: ag.position },
                  { role: 'user', content: debatePrompt }
                ]

                const result = await streamAgent(ag.agent, messages, 'debate', signal, round, mcpTools)
                if (signal.aborted) return

                const parsed = splitDebateResponse(result.content)
                const unchanged = !runtime.legacyDebate && (parsed.unchanged || parsed.revised === ag.position)
                if (unchanged) unchangedCount++
                else ag.position = parsed.revised
                ag.lastCritique = parsed.critique || null
                reports.push({ name: ag.agent.name, status: parsed.status })
                const stored = parsed.unchanged ? ag.position : result.content
                insertAgentMessage('debate', ag.agent, stored, result.tokenCount, round, result.toolResults)
                send('stream:done', { agentId: ag.agent.id, agentName: ag.agent.name, provider: ag.agent.provider, fullContent: stored, tokenCount: result.tokenCount, phase: 'debate', round, toolResults: result.toolResults })
                freshCount++
              } catch (err: unknown) {
                // Agent drops out of this round but keeps its last position for synthesis
                if (!signal.aborted) {
                  send('stream:error', {
                    agentId: ag.agent.id,
                    agentName: ag.agent.name,
                    provider: ag.agent.provider,
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
          const stagnated = !runtime.legacyDebate && freshCount === agents.length && unchangedCount === agents.length && openIssues.length > 0 && !reports.some((r) => r.status?.newIssues.length)
          if (freshCount < 2) {
            verdict = {
              converged: !!runtime.legacyDebate,
              disagreements: openIssues.map((i) => `${i.id}: ${i.description}`),
              issues: openIssues,
              parseFailed: !runtime.legacyDebate,
              summary: 'Fewer than two agents responded — ending the debate without confirmed agreement.'
            }
          } else if (stagnated) {
            verdict = { converged: false, issues: openIssues, disagreements: openIssues.map((i) => `${i.id}: ${i.description}`), summary: 'Positions unchanged while substantive disagreements remain.' }
          } else {
            send('stream:phase', { phase: 'moderating', round, maxRounds: maxDebateRounds })
            const moderatorMessages: ChatMessage[] = [
              {
                role: 'user',
                content: getModeratorPrompt(
                  prompt,
                  agents.map((ag) => ({ name: ag.agent.name, position: ag.position })),
                  round,
                  openIssues,
                  reports
                )
              }
            ]
            try {
              const result = await collectCompletion(synthesizerAgent, moderatorMessages, signal, round, (input, output) => {
                moderatorInputTokens += input
                moderatorOutputTokens += output
              })
              verdict = parseModeratorVerdict(result.content, openIssues, issueHistory)
            } catch {
              // A moderator failure must never sink the deliberation — end the
              // debate and proceed to synthesis
              if (signal.aborted) return
              verdict = {
                converged: !!runtime.legacyDebate,
                disagreements: openIssues.map((i) => `${i.id}: ${i.description}`),
                issues: openIssues,
                summary: 'Moderator unavailable — ending the debate without confirmed agreement.',
                parseFailed: true
              }
            }
            if (signal.aborted) return
          }

          openIssues = verdict.issues ?? []
          for (const issue of openIssues) {
            const old = issueHistory.findIndex((i) => i.id === issue.id)
            if (old < 0) issueHistory.push(issue)
            else issueHistory[old] = issue
          }
          const reason = runtime.legacyDebate
            ? (verdict.converged ? 'converged' : round >= maxDebateRounds ? 'budget_exhausted' : null)
            : verdict.parseFailed || freshCount < 2 ? 'degraded'
            : stagnated ? 'stagnated'
            : verdict.converged ? 'converged'
            : round >= maxDebateRounds ? 'budget_exhausted' : null
          const continuing = reason === null
          if (reason) terminationReason = reason
          const storedVerdict = { ...verdict, terminationReason: reason }
          const verdictJson = JSON.stringify(storedVerdict)
        insertAgentMessage('moderator', synthesizerAgent, verdictJson, moderatorOutputTokens, round)
          send('stream:moderator', {
            round, maxRounds: maxDebateRounds, ...storedVerdict, continuing,
            inputTokens: moderatorInputTokens, outputTokens: moderatorOutputTokens
          })
          roundSummaries.push({ round, disagreements: verdict.disagreements, terminationReason: reason })

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
        const tokenCount = 0
        insertAgentMessage('synthesis', only.agent, only.position, tokenCount, 0)
        send('stream:done', {
          agentId: only.agent.id,
          agentName: only.agent.name,
          provider: only.agent.provider,
          fullContent: only.position,
          tokenCount,
          phase: 'synthesis',
          reused: true
        })
      } else {
        const synthesisPrompt = getSynthesisPrompt(
          prompt,
          agents.map((ag) => ({
            name: ag.agent.name,
            initial: ag.initial,
            final: ag.position
          })),
          roundSummaries
        )

        try {
          const synthMessages: ChatMessage[] = [{ role: 'user', content: synthesisPrompt }]

          const result = await streamAgent(synthesizerAgent, synthMessages, 'synthesis', signal)

          if (!signal.aborted) {
            insertAgentMessage('synthesis', synthesizerAgent, result.content, result.tokenCount, 0)
          }
        } catch (err: unknown) {
          if (!signal.aborted) {
            terminationReason = 'degraded'
            send('stream:error', {
              agentId: synthesizerAgent.id,
              agentName: synthesizerAgent.name,
              provider: synthesizerAgent.provider,
              message: cleanErrorMessage(err),
              phase: 'synthesis'
            })
          }
        }
      }
    } catch (err) {
      // Without this, an unexpected throw only rejects the IPC promise, which
      // the renderer never displays — the turn would fail silently
      terminationReason = 'degraded'
      if (!signal.aborted) {
        send('stream:notice', { message: `Deliberation failed: ${cleanErrorMessage(err)}` })
      }
    } finally {
      if (signal.aborted) terminationReason = 'cancelled'
      if (userMsgId) db.prepare('UPDATE messages SET termination_reason = ? WHERE id = ?').run(terminationReason, userMsgId)
      db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId)
      if (currentAbortController === abortController) {
        currentAbortController = null
      }
      // On abort the renderer ends the deliberation itself; a late 'complete'
      // here could clobber a newer deliberation that superseded this one
      if (!signal.aborted) {
        send('stream:phase', { phase: 'complete', terminationReason })
      }
    }
  }

  function cancelDeliberation(): void {
    if (currentAbortController) {
      currentAbortController.abort()
      currentAbortController = null
    }
  }

  return { startDeliberation, cancelDeliberation }
}
