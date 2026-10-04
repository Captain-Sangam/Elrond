import { create } from 'zustand'
import { effectiveSynthesizer, useAgentsStore } from './agentsStore'
import { deriveTurnStats } from '@renderer/lib/turnStats'
import type {
  DeliberationNotice,
  Message,
  ModeratorVerdictEvent,
  PhaseChange,
  Session,
  StreamDone,
  StreamError,
  StreamStart,
  StreamToken,
  StreamToolEvent,
  TurnStats,
  TerminationReason,
  DebateTerminationReason
} from '@shared/types'

// One MCP tool call shown inline in a streaming message; upserted by callId
// as it moves running → ok/error. Live-turn only — not persisted.
export interface ToolCallChip {
  callId: string
  toolName: string
  serverName: string
  status: 'running' | 'ok' | 'error'
  argsPreview?: string
  resultPreview?: string
  errorMessage?: string
  durationMs?: number
}

export interface AgentStream {
  content: string
  tokenCount: number
  isStreaming: boolean
  error: string | null
  toolCalls: ToolCallChip[]
  reused?: boolean
}

export interface DebateVerdict {
  converged: boolean
  disagreements: string[]
  summary: string
  continuing: boolean
  terminationReason?: DebateTerminationReason | null
}

export interface DebateRoundState {
  round: number
  streams: Record<string, AgentStream>
  moderating: boolean
  verdict: DebateVerdict | null
  moderatorTokens: { input: number; output: number } | null
}

// Optimistic preview of attachments on the in-flight prompt
export interface PendingAttachmentPreview {
  fileName: string
  mimeType: string
  previewUrl: string | null
}

// A finished turn's stats. Persisted to turn_stats on completion and reloaded
// on session load, so the rail survives a session switch or app restart.
// Re-exported from shared types, where main needs it too.
export type { TurnStats } from '@shared/types'

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Message[]
  isDeliberating: boolean
  currentPhase: string | null
  currentRound: number
  maxRounds: number
  currentPrompt: string | null
  currentAttachments: PendingAttachmentPreview[]
  totalCost: number

  agentStreams: Record<string, AgentStream>
  debateRounds: DebateRoundState[]
  synthesisStream: AgentStream

  // Live stats for the in-flight turn: estimated prompt size per agent
  // call, keyed `${phase}:${round}:${agentId}`, plus wall-clock bounds
  callInputTokens: Record<string, number>
  deliberationStartedAt: number | null
  deliberationEndedAt: number | null

  // Non-fatal notices for the in-flight turn (e.g. "Web search skipped: ...")
  notices: string[]

  // Per-turn stats for this session, loaded from the DB and appended to as
  // turns finish (survives resetStreams)
  turnStats: TurnStats[]

  // 1-based number of the in-flight turn, used to key its persisted stats so
  // archiving the same turn twice overwrites instead of duplicating
  currentTurn: number
  terminationReason: TerminationReason | null

  loadSessions: () => Promise<void>
  setActiveSession: (id: string | null) => Promise<void>
  createSession: (title?: string) => Promise<Session>
  deleteSession: (id: string) => Promise<void>
  updateSession: (id: string, updates: Partial<Pick<Session, 'title' | 'starred'>>) => Promise<void>
  searchSessions: (query: string) => Promise<void>

  startDeliberation: (prompt: string, attachments?: PendingAttachmentPreview[]) => void
  archiveCurrentTurn: () => void
  handleStreamStart: (start: StreamStart) => void
  handleStreamToken: (token: StreamToken) => void
  handleStreamDone: (done: StreamDone) => void
  handleStreamError: (error: StreamError) => void
  handlePhaseChange: (phase: PhaseChange) => void
  handleModeratorVerdict: (verdict: ModeratorVerdictEvent) => void
  handleNotice: (notice: DeliberationNotice) => void
  handleStreamTool: (event: StreamToolEvent) => void
  endDeliberation: () => void
  resetStreams: () => void
  reloadMessages: () => Promise<void>
}

const emptyStream = (): AgentStream => ({
  content: '',
  tokenCount: 0,
  isStreaming: false,
  error: null,
  toolCalls: []
})

const upsertToolChip = (chips: ToolCallChip[], event: StreamToolEvent): ToolCallChip[] => {
  const chip: ToolCallChip = {
    callId: event.callId,
    toolName: event.toolName,
    serverName: event.serverName,
    status: event.status,
    argsPreview: event.argsPreview,
    resultPreview: event.resultPreview,
    errorMessage: event.errorMessage,
    durationMs: event.durationMs
  }
  const idx = chips.findIndex((c) => c.callId === event.callId)
  if (idx === -1) return [...chips, chip]
  const next = [...chips]
  next[idx] = { ...next[idx], ...chip }
  return next
}

const emptyRound = (round: number): DebateRoundState => ({
  round,
  streams: {},
  moderating: false,
  verdict: null,
  moderatorTokens: null
})

const ensureRounds = (rounds: DebateRoundState[], upTo: number): DebateRoundState[] => {
  const next = [...rounds]
  while (next.length < upTo) {
    next.push(emptyRound(next.length + 1))
  }
  return next
}

const revokePreviews = (attachments: PendingAttachmentPreview[]): void => {
  for (const a of attachments) {
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
  }
}

const updateRoundStream = (
  rounds: DebateRoundState[],
  round: number,
  agentId: string,
  updater: (prev: AgentStream) => AgentStream
): DebateRoundState[] => {
  const next = ensureRounds(rounds, round)
  const idx = round - 1
  next[idx] = {
    ...next[idx],
    streams: {
      ...next[idx].streams,
      [agentId]: updater(next[idx].streams[agentId] || emptyStream())
    }
  }
  return next
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isDeliberating: false,
  currentPhase: null,
  currentRound: 0,
  maxRounds: 0,
  currentPrompt: null,
  currentAttachments: [],
  totalCost: 0,

  agentStreams: {},
  debateRounds: [],
  synthesisStream: emptyStream(),

  callInputTokens: {},
  deliberationStartedAt: null,
  deliberationEndedAt: null,
  notices: [],
  turnStats: [],
  currentTurn: 1,
  terminationReason: null,

  loadSessions: async () => {
    const sessions = await window.elrond.getSessions()
    set({ sessions })
  },

  setActiveSession: async (id) => {
    set({ activeSessionId: id, turnStats: [], currentTurn: 1 })
    if (id) {
      // Persisted per-turn stats, so the rail shows history instead of zeros
      const [messages, turnStats] = await Promise.all([
        window.elrond.getMessages(id),
        window.elrond.getTurnStats(id)
      ])
      // Resume numbering after the loaded turns so a new turn doesn't
      // overwrite turn 1's persisted row
      const maxTurn = turnStats.reduce((m, t) => Math.max(m, t.turn), 0)
      set({ messages, turnStats, currentTurn: maxTurn + 1 })
    } else {
      set({ messages: [] })
    }
    get().resetStreams()
  },

  createSession: async (title) => {
    const session = await window.elrond.createSession(title)
    await get().loadSessions()
    await get().setActiveSession(session.id)
    return session
  },

  deleteSession: async (id) => {
    await window.elrond.deleteSession(id)
    if (get().activeSessionId === id) {
      set({ activeSessionId: null, messages: [] })
    }
    await get().loadSessions()
  },

  updateSession: async (id, updates) => {
    await window.elrond.updateSession(id, updates)
    await get().loadSessions()
  },

  searchSessions: async (query) => {
    if (!query.trim()) {
      await get().loadSessions()
      return
    }
    const sessions = await window.elrond.searchSessions(query)
    set({ sessions })
  },

  archiveCurrentTurn: () => {
    const state = get()
    if (state.deliberationStartedAt === null) return

    const { agents, synthesizerAgentId } = useAgentsStore.getState()
    const totals = deriveTurnStats({
      enabledAgents: agents.filter((a) => a.enabled),
      synthesizerAgent: effectiveSynthesizer({ agents, synthesizerAgentId }),
      agentStreams: state.agentStreams,
      debateRounds: state.debateRounds,
      synthesisStream: state.synthesisStream,
      callInputTokens: state.callInputTokens,
      isDeliberating: false,
      currentPhase: null
    })
    if (totals.input + totals.output === 0) return

    const lastVerdict =
      state.debateRounds.length > 0
        ? state.debateRounds[state.debateRounds.length - 1].verdict
        : null
    // Overwrite the entry for this turn if it's already archived, so running
    // this on both completion and next-turn-start stays idempotent
    const existing = state.turnStats.findIndex((t) => t.turn === state.currentTurn)
    const stats: TurnStats = {
      turn: state.currentTurn,
      input: totals.input,
      output: totals.output,
      cost: totals.cost,
      elapsedMs: Math.max(
        0,
        (state.deliberationEndedAt ?? Date.now()) - state.deliberationStartedAt
      ),
      rounds: state.debateRounds.length,
      converged: lastVerdict?.converged ?? null,
      terminationReason: state.terminationReason ?? lastVerdict?.terminationReason ?? null
    }
    const turnStats = [...state.turnStats]
    if (existing >= 0) turnStats[existing] = stats
    else turnStats.push(stats)
    set({ turnStats })

    // Persist so the rail survives a session switch or restart. Fire-and-forget:
    // a failed write must not break the deliberation.
    if (state.activeSessionId) {
      window.elrond.saveTurnStats(state.activeSessionId, stats).catch(() => {})
    }
  },

  startDeliberation: (prompt, attachments) => {
    // Archive the finished turn before the reset wipes its live state, so
    // follow-up questions stack in the stats rail instead of zeroing it
    get().archiveCurrentTurn()

    get().resetStreams()
    revokePreviews(get().currentAttachments)
    // Advance past every archived turn. Derived from turnStats rather than
    // incremented, so a turn that produced no tokens (and so wasn't archived)
    // doesn't leave a gap in the numbering.
    const archived = get().turnStats.reduce((m, t) => Math.max(m, t.turn), 0)
    set({
      isDeliberating: true,
      currentPhase: 'initial',
      currentPrompt: prompt,
      currentAttachments: attachments ?? [],
      deliberationStartedAt: Date.now(),
      deliberationEndedAt: null,
      currentTurn: archived + 1
    })
  },

  handleStreamStart: (start) => {
    const key = `${start.phase}:${start.round ?? 0}:${start.agentId}${start.callId ? `:${start.callId}` : ''}`
    set((state) => ({
      callInputTokens: { ...state.callInputTokens, [key]: start.inputTokens }
    }))
  },

  handleStreamToken: (token) => {
    const { phase, agentId, delta } = token

    if (phase === 'initial') {
      set((state) => ({
        agentStreams: {
          ...state.agentStreams,
          [agentId]: {
            ...(state.agentStreams[agentId] || emptyStream()),
            content: (state.agentStreams[agentId]?.content || '') + delta,
            isStreaming: true
          }
        }
      }))
    } else if (phase === 'debate') {
      const round = token.round ?? 1
      set((state) => ({
        debateRounds: updateRoundStream(state.debateRounds, round, agentId, (prev) => ({
          ...prev,
          content: prev.content + delta,
          isStreaming: true
        }))
      }))
    } else if (phase === 'synthesis') {
      set((state) => ({
        synthesisStream: {
          ...state.synthesisStream,
          content: state.synthesisStream.content + delta,
          isStreaming: true
        }
      }))
    }
  },

  handleStreamDone: (done) => {
    const { phase, agentId, fullContent, tokenCount } = done

    if (phase === 'initial') {
      set((state) => ({
        agentStreams: {
          ...state.agentStreams,
          [agentId]: {
            content: fullContent,
            tokenCount,
            isStreaming: false,
            error: null,
            toolCalls: state.agentStreams[agentId]?.toolCalls ?? []
          }
        }
      }))
    } else if (phase === 'debate') {
      const round = done.round ?? 1
      set((state) => ({
        debateRounds: updateRoundStream(state.debateRounds, round, agentId, (prev) => ({
          content: fullContent,
          tokenCount,
          isStreaming: false,
          error: null,
          toolCalls: prev.toolCalls
        }))
      }))
    } else if (phase === 'synthesis') {
      set({
        synthesisStream: { ...emptyStream(), content: fullContent, tokenCount, ...(done.reused ? { reused: true } : {}) }
      })
    }
  },

  handleStreamError: (error) => {
    const { agentId, message } = error

    if (error.phase === 'debate') {
      const round = error.round ?? 1
      set((state) => ({
        debateRounds: updateRoundStream(state.debateRounds, round, agentId, (prev) => ({
          ...prev,
          error: message,
          isStreaming: false
        }))
      }))
    } else if (error.phase === 'synthesis') {
      set((state) => ({
        synthesisStream: { ...state.synthesisStream, error: message, isStreaming: false }
      }))
    } else {
      set((state) => ({
        agentStreams: {
          ...state.agentStreams,
          [agentId]: {
            content: '',
            tokenCount: 0,
            error: message,
            isStreaming: false,
            toolCalls: state.agentStreams[agentId]?.toolCalls ?? []
          }
        }
      }))
    }
  },

  handleStreamTool: (event) => {
    if (event.phase === 'initial') {
      set((state) => {
        const prev = state.agentStreams[event.agentId] || emptyStream()
        return {
          agentStreams: {
            ...state.agentStreams,
            [event.agentId]: { ...prev, toolCalls: upsertToolChip(prev.toolCalls, event) }
          }
        }
      })
    } else if (event.phase === 'debate') {
      const round = event.round ?? 1
      set((state) => ({
        debateRounds: updateRoundStream(state.debateRounds, round, event.agentId, (prev) => ({
          ...prev,
          toolCalls: upsertToolChip(prev.toolCalls, event)
        }))
      }))
    }
    // Synthesis never runs tools — nothing to render there
  },

  handlePhaseChange: (phase) => {
    if (phase.phase === 'complete') {
      set({ deliberationEndedAt: Date.now(), terminationReason: phase.terminationReason ?? null })
      // Persist now, not just on the next turn's archive pass: this is the only
      // save the last turn of a session ever gets
      get().archiveCurrentTurn()
      // Load the persisted messages before hiding the live panels so the
      // finished deliberation doesn't flicker out of view
      get()
        .reloadMessages()
        .then(() => {
          revokePreviews(get().currentAttachments)
          set({ isDeliberating: false, currentPhase: null, currentPrompt: null, currentAttachments: [] })
        })
      return
    }

    set((state) => {
      const updates: Partial<SessionState> = { currentPhase: phase.phase }
      if (phase.round) updates.currentRound = phase.round
      if (phase.maxRounds) updates.maxRounds = phase.maxRounds
      if (phase.phase === 'debate' && phase.round) {
        updates.debateRounds = ensureRounds(state.debateRounds, phase.round)
      } else if (phase.phase === 'moderating' && phase.round) {
        const rounds = ensureRounds(state.debateRounds, phase.round)
        rounds[phase.round - 1] = { ...rounds[phase.round - 1], moderating: true }
        updates.debateRounds = rounds
      }
      return updates
    })
  },

  handleModeratorVerdict: (verdict) => {
    set((state) => {
      const rounds = ensureRounds(state.debateRounds, verdict.round)
      rounds[verdict.round - 1] = {
        ...rounds[verdict.round - 1],
        moderating: false,
        verdict: {
          converged: verdict.converged,
          disagreements: verdict.disagreements,
          summary: verdict.summary,
          continuing: verdict.continuing,
          ...(verdict.terminationReason !== undefined ? { terminationReason: verdict.terminationReason } : {})
        },
        moderatorTokens: { input: verdict.inputTokens ?? 0, output: verdict.outputTokens ?? 0 }
      }
      return { debateRounds: rounds, maxRounds: verdict.maxRounds }
    })
  },

  handleNotice: (notice) => {
    set((state) => ({ notices: [...state.notices, notice.message] }))
  },

  endDeliberation: () => {
    revokePreviews(get().currentAttachments)
    set((state) => ({
      isDeliberating: false,
      currentPhase: null,
      currentPrompt: null,
      currentAttachments: [],
      // Cancelled runs never get a 'complete' event — stop the clock here
      deliberationEndedAt: state.deliberationEndedAt ?? Date.now(),
      terminationReason: state.terminationReason ?? 'cancelled'
    }))
  },

  resetStreams: () => {
    set({
      agentStreams: {},
      debateRounds: [],
      synthesisStream: emptyStream(),
      currentPhase: null,
      currentRound: 0,
      maxRounds: 0,
      totalCost: 0,
      callInputTokens: {},
      deliberationStartedAt: null,
      deliberationEndedAt: null,
      notices: [],
      terminationReason: null
    })
  },

  reloadMessages: async () => {
    const { activeSessionId } = get()
    if (activeSessionId) {
      const messages = await window.elrond.getMessages(activeSessionId)
      set({ messages })
      await get().loadSessions()
    }
  }
}))
