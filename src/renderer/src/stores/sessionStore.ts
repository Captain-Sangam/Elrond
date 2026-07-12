import { create } from 'zustand'
import type {
  Message,
  ModeratorVerdictEvent,
  PhaseChange,
  Session,
  StreamDone,
  StreamError,
  StreamStart,
  StreamToken
} from '@shared/types'

export interface AgentStream {
  content: string
  tokenCount: number
  isStreaming: boolean
  error: string | null
}

export interface DebateVerdict {
  converged: boolean
  disagreements: string[]
  summary: string
  continuing: boolean
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

  // Live stats for the in-flight turn: estimated prompt size per provider
  // call, keyed `${phase}:${round}:${provider}`, plus wall-clock bounds
  callInputTokens: Record<string, number>
  deliberationStartedAt: number | null
  deliberationEndedAt: number | null

  loadSessions: () => Promise<void>
  setActiveSession: (id: string | null) => Promise<void>
  createSession: (title?: string) => Promise<Session>
  deleteSession: (id: string) => Promise<void>
  updateSession: (id: string, updates: Partial<Pick<Session, 'title' | 'starred'>>) => Promise<void>
  searchSessions: (query: string) => Promise<void>

  startDeliberation: (prompt: string, attachments?: PendingAttachmentPreview[]) => void
  handleStreamStart: (start: StreamStart) => void
  handleStreamToken: (token: StreamToken) => void
  handleStreamDone: (done: StreamDone) => void
  handleStreamError: (error: StreamError) => void
  handlePhaseChange: (phase: PhaseChange) => void
  handleModeratorVerdict: (verdict: ModeratorVerdictEvent) => void
  endDeliberation: () => void
  resetStreams: () => void
  reloadMessages: () => Promise<void>
}

const emptyStream = (): AgentStream => ({
  content: '',
  tokenCount: 0,
  isStreaming: false,
  error: null
})

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
  provider: string,
  updater: (prev: AgentStream) => AgentStream
): DebateRoundState[] => {
  const next = ensureRounds(rounds, round)
  const idx = round - 1
  next[idx] = {
    ...next[idx],
    streams: {
      ...next[idx].streams,
      [provider]: updater(next[idx].streams[provider] || emptyStream())
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

  loadSessions: async () => {
    const sessions = await window.elrond.getSessions()
    set({ sessions })
  },

  setActiveSession: async (id) => {
    set({ activeSessionId: id })
    if (id) {
      const messages = await window.elrond.getMessages(id)
      set({ messages })
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

  startDeliberation: (prompt, attachments) => {
    get().resetStreams()
    revokePreviews(get().currentAttachments)
    set({
      isDeliberating: true,
      currentPhase: 'initial',
      currentPrompt: prompt,
      currentAttachments: attachments ?? [],
      deliberationStartedAt: Date.now(),
      deliberationEndedAt: null
    })
  },

  handleStreamStart: (start) => {
    const key = `${start.phase}:${start.round ?? 0}:${start.provider}`
    set((state) => ({
      callInputTokens: { ...state.callInputTokens, [key]: start.inputTokens }
    }))
  },

  handleStreamToken: (token) => {
    const { phase, provider, delta } = token

    if (phase === 'initial') {
      set((state) => ({
        agentStreams: {
          ...state.agentStreams,
          [provider]: {
            ...(state.agentStreams[provider] || emptyStream()),
            content: (state.agentStreams[provider]?.content || '') + delta,
            isStreaming: true
          }
        }
      }))
    } else if (phase === 'debate') {
      const round = token.round ?? 1
      set((state) => ({
        debateRounds: updateRoundStream(state.debateRounds, round, provider, (prev) => ({
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
    const { phase, provider, fullContent, tokenCount } = done

    if (phase === 'initial') {
      set((state) => ({
        agentStreams: {
          ...state.agentStreams,
          [provider]: { content: fullContent, tokenCount, isStreaming: false, error: null }
        }
      }))
    } else if (phase === 'debate') {
      const round = done.round ?? 1
      set((state) => ({
        debateRounds: updateRoundStream(state.debateRounds, round, provider, () => ({
          content: fullContent,
          tokenCount,
          isStreaming: false,
          error: null
        }))
      }))
    } else if (phase === 'synthesis') {
      set({
        synthesisStream: { content: fullContent, tokenCount, isStreaming: false, error: null }
      })
    }
  },

  handleStreamError: (error) => {
    const { provider, message } = error

    if (error.phase === 'debate') {
      const round = error.round ?? 1
      set((state) => ({
        debateRounds: updateRoundStream(state.debateRounds, round, provider, (prev) => ({
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
          [provider]: {
            content: '',
            tokenCount: 0,
            error: message,
            isStreaming: false
          }
        }
      }))
    }
  },

  handlePhaseChange: (phase) => {
    if (phase.phase === 'complete') {
      set({ deliberationEndedAt: Date.now() })
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
          continuing: verdict.continuing
        },
        moderatorTokens: { input: verdict.inputTokens ?? 0, output: verdict.outputTokens ?? 0 }
      }
      return { debateRounds: rounds, maxRounds: verdict.maxRounds }
    })
  },

  endDeliberation: () => {
    revokePreviews(get().currentAttachments)
    set({ isDeliberating: false, currentPhase: null, currentPrompt: null, currentAttachments: [] })
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
      deliberationEndedAt: null
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
