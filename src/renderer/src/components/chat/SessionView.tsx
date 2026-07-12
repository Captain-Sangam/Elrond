import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSessionStore } from '@renderer/stores/sessionStore'
import { useAgentsStore } from '@renderer/stores/agentsStore'
import { AgentPanel } from './AgentPanel'
import { DebatePanel, type DebateRoundView } from './DebatePanel'
import { SynthesisPanel } from './SynthesisPanel'
import { MessageInput } from './MessageInput'
import { StatsPanel } from '@renderer/components/layout/StatsPanel'
import { resolveAgentMeta } from '@renderer/lib/providers'
import type { AgentConfig, Attachment, Message } from '@shared/types'
import type { DebateVerdict } from '@renderer/stores/sessionStore'
import { Sparkles, User, GitBranch, ArrowDown, FileText, Loader2 } from 'lucide-react'

interface HistoryRound {
  debates: Message[]
  moderator: Message | null
}

interface HistoryTurn {
  user: Message
  agents: Message[]
  debateRounds: Map<number, HistoryRound>
  synthesis: Message | null
}

function parseStoredVerdict(msg: Message | null, hasNextRound: boolean): DebateVerdict | null {
  if (!msg) return null
  try {
    const v = JSON.parse(msg.content)
    return {
      converged: Boolean(v.converged),
      disagreements: Array.isArray(v.disagreements) ? v.disagreements.map(String) : [],
      summary: typeof v.summary === 'string' ? v.summary : '',
      continuing: hasNextRound
    }
  } catch {
    return null
  }
}

function toHistoryRoundViews(turn: HistoryTurn, agents: AgentConfig[]): DebateRoundView[] {
  const roundNums = Array.from(turn.debateRounds.keys()).sort((a, b) => a - b)
  const maxRound = roundNums[roundNums.length - 1]
  return roundNums.map((n) => {
    const data = turn.debateRounds.get(n)!
    return {
      round: n,
      entries: data.debates.map((d) => {
        const meta = resolveAgentMeta(d.agent_name, d.provider, agents)
        return {
          // Stored rounds use the message id as the stable key; live rounds
          // use the real agent id
          agentId: d.agent_id ?? d.id,
          agentName: meta.displayName,
          provider: meta.provider,
          content: d.content,
          isStreaming: false,
          error: null
        }
      }),
      verdict: parseStoredVerdict(data.moderator, n < maxRound),
      moderating: false
    }
  })
}

function AttachmentStrip({ attachments }: { attachments: Attachment[] }): React.JSX.Element | null {
  if (attachments.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a) =>
        a.mime_type.startsWith('image/') ? (
          <img
            key={a.id}
            src={`elrond-attachment://${a.id}`}
            alt={a.file_name}
            className="max-h-40 max-w-60 rounded-md border object-contain"
          />
        ) : (
          <div key={a.id} className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs">{a.file_name}</span>
          </div>
        )
      )}
    </div>
  )
}

export function SessionView({ statsOpen }: { statsOpen: boolean }): React.JSX.Element {
  const {
    activeSessionId,
    sessions,
    messages,
    isDeliberating,
    currentPhase,
    currentRound,
    maxRounds,
    currentPrompt,
    currentAttachments,
    agentStreams,
    debateRounds,
    synthesisStream,
    notices
  } = useSessionStore()

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const { agents } = useAgentsStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  // Follow the stream only while the user is at the bottom; scrolling up unpins
  const pinnedRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const [showJumpButton, setShowJumpButton] = useState(false)

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false
      return
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    pinnedRef.current = atBottom
    setShowJumpButton(!atBottom)
  }, [])

  const handleJumpToBottom = useCallback(() => {
    pinnedRef.current = true
    setShowJumpButton(false)
    scrollToBottom()
  }, [scrollToBottom])

  useEffect(() => {
    if (pinnedRef.current) scrollToBottom()
  }, [messages, agentStreams, debateRounds, synthesisStream, scrollToBottom])

  useEffect(() => {
    pinnedRef.current = true
    setShowJumpButton(false)
    scrollToBottom()
  }, [activeSessionId, scrollToBottom])

  if (!activeSessionId) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Welcome to Elrond</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a new session to deliberate with multiple AI agents.
            </p>
          </div>
        </div>
        <MessageInput />
      </div>
    )
  }

  const enabledAgents = agents.filter((a) => a.enabled)
  const hasActiveStreams = Object.values(agentStreams).some((s) => s.content || s.error)

  // Hide the in-flight turn from history; the live panels render it instead
  const pastMessages = !isDeliberating
    ? messages
    : (() => {
        const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')
        if (lastUserIdx !== -1 && messages[lastUserIdx].content === currentPrompt) {
          return messages.slice(0, lastUserIdx)
        }
        return messages
      })()

  // Group saved messages into deliberation turns for display
  const turns: HistoryTurn[] = []
  let currentTurn: HistoryTurn | null = null

  for (const msg of pastMessages) {
    if (msg.role === 'user') {
      if (currentTurn) turns.push(currentTurn)
      currentTurn = { user: msg, agents: [], debateRounds: new Map(), synthesis: null }
    } else if (currentTurn) {
      if (msg.role === 'agent') {
        currentTurn.agents.push(msg)
      } else if (msg.role === 'debate' || msg.role === 'moderator') {
        const round = msg.round || 1
        const entry = currentTurn.debateRounds.get(round) ?? { debates: [], moderator: null }
        if (msg.role === 'debate') entry.debates.push(msg)
        else entry.moderator = msg
        currentTurn.debateRounds.set(round, entry)
      } else if (msg.role === 'synthesis') {
        currentTurn.synthesis = msg
      }
    }
  }
  if (currentTurn) turns.push(currentTurn)

  const liveRoundViews: DebateRoundView[] = debateRounds.map((r) => ({
    round: r.round,
    entries: enabledAgents.map((a) => ({
      agentId: a.id,
      agentName: a.name,
      provider: a.provider,
      content: r.streams[a.id]?.content || '',
      isStreaming: r.streams[a.id]?.isStreaming || false,
      error: r.streams[a.id]?.error || null,
      toolCalls: r.streams[a.id]?.toolCalls || []
    })),
    verdict: r.verdict,
    moderating: r.moderating
  }))

  const phaseLabel = (() => {
    switch (currentPhase) {
      case 'fetching_context':
        return 'Fetching repository context...'
      case 'searching_web':
        return 'Searching the web...'
      case 'initial':
        return 'Agents are answering...'
      case 'debate':
        return maxRounds ? `Debate round ${currentRound} of ${maxRounds}...` : 'Agents are debating...'
      case 'moderating':
        return `Moderator is reviewing round ${currentRound}...`
      case 'synthesis':
        return 'Synthesizing the final answer...'
      default:
        return null
    }
  })()

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-5xl space-y-6">
            {activeSession?.repo_id && (
              <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2">
                <GitBranch className="h-4 w-4 text-green-400" />
                <span className="text-xs font-medium text-green-400">Code Session</span>
                <span className="text-xs text-muted-foreground">
                  Agents have access to the indexed repository
                </span>
              </div>
            )}

            {turns.map((turn) => (
              <div key={turn.user.id} className="space-y-4">
                {/* User message */}
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    {/* Plain text, not markdown — a user's newlines must render as typed */}
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {turn.user.content}
                    </p>
                    <AttachmentStrip attachments={turn.user.attachments || []} />
                  </div>
                </div>

                {/* Agent responses */}
                {turn.agents.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {turn.agents.map((msg) => {
                      const meta = resolveAgentMeta(msg.agent_name, msg.provider, agents)
                      return (
                        <AgentPanel
                          key={msg.id}
                          agentName={meta.displayName}
                          provider={meta.provider}
                          content={msg.content}
                          isStreaming={false}
                          error={null}
                          tokenCount={msg.token_count || undefined}
                        />
                      )
                    })}
                  </div>
                )}

                {/* Debate rounds */}
                {turn.debateRounds.size > 0 && (
                  <DebatePanel rounds={toHistoryRoundViews(turn, agents)} isActive={false} />
                )}

                {/* Synthesis */}
                {turn.synthesis && (
                  <SynthesisPanel
                    content={turn.synthesis.content}
                    isStreaming={false}
                    tokenCount={turn.synthesis.token_count || undefined}
                  />
                )}
              </div>
            ))}

            {/* Current prompt shown immediately while deliberating */}
            {isDeliberating && currentPrompt && (
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {currentPrompt}
                  </p>
                  {currentAttachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {currentAttachments.map((a, i) =>
                        a.previewUrl ? (
                          <img
                            key={i}
                            src={a.previewUrl}
                            alt={a.fileName}
                            className="max-h-40 max-w-60 rounded-md border object-contain"
                          />
                        ) : (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1"
                          >
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs">{a.fileName}</span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Non-fatal notices — shown during AND after the turn (a failed
                turn completes instantly, so these must outlive isDeliberating) */}
            {notices.map((notice, i) => (
              <div key={i} className="text-xs text-amber-400">
                {notice}
              </div>
            ))}

            {/* Active streaming panels — only while deliberating */}
            {isDeliberating && (
              <div className="space-y-4">
                {phaseLabel && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {phaseLabel}
                  </div>
                )}

                {hasActiveStreams && (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {enabledAgents.map((agent) => {
                      const stream = agentStreams[agent.id]
                      return (
                        <AgentPanel
                          key={agent.id}
                          agentName={agent.name}
                          provider={agent.provider}
                          content={stream?.content || ''}
                          isStreaming={stream?.isStreaming || false}
                          error={stream?.error || null}
                          tokenCount={stream?.tokenCount}
                          toolCalls={stream?.toolCalls}
                        />
                      )
                    })}
                  </div>
                )}

                {(liveRoundViews.length > 0 || currentPhase === 'debate') && (
                  <DebatePanel
                    rounds={liveRoundViews}
                    maxRounds={maxRounds || undefined}
                    isActive={currentPhase === 'debate' || currentPhase === 'moderating'}
                  />
                )}

                {(synthesisStream.content || synthesisStream.error || currentPhase === 'synthesis') && (
                  <SynthesisPanel
                    content={synthesisStream.content}
                    isStreaming={synthesisStream.isStreaming}
                    tokenCount={synthesisStream.tokenCount || undefined}
                    error={synthesisStream.error}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {showJumpButton && (
          <button
            onClick={handleJumpToBottom}
            className="absolute bottom-4 right-8 flex h-9 w-9 items-center justify-center rounded-full border bg-background/90 shadow-md transition-colors hover:bg-accent"
            title="Jump to bottom"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
        </div>

        <MessageInput />
      </div>

      {statsOpen && <StatsPanel />}
    </div>
  )
}
