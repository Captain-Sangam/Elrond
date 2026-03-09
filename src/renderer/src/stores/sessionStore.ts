import { create } from 'zustand'
import type { Session, Message, ProviderName, StreamToken, StreamDone } from '@shared/types'

interface AgentStream {
  content: string
  tokenCount: number
  isStreaming: boolean
  error: string | null
}

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Message[]
  isDeliberating: boolean
  currentPhase: string | null
  currentPrompt: string | null
  totalCost: number

  agentStreams: Record<string, AgentStream>
  debateStreams: Record<string, AgentStream>
  synthesisStream: AgentStream

  loadSessions: () => Promise<void>
  setActiveSession: (id: string | null) => Promise<void>
  createSession: (title?: string) => Promise<Session>
  deleteSession: (id: string) => Promise<void>
  updateSession: (id: string, updates: Partial<Pick<Session, 'title' | 'starred'>>) => Promise<void>
  searchSessions: (query: string) => Promise<void>

  startDeliberation: (prompt: string) => void
  handleStreamToken: (token: StreamToken) => void
  handleStreamDone: (done: StreamDone) => void
  handleStreamError: (error: { provider: ProviderName; message: string }) => void
  handlePhaseChange: (phase: { phase: string; provider?: ProviderName }) => void
  endDeliberation: () => void
  resetStreams: () => void
}

const emptyStream = (): AgentStream => ({
  content: '',
  tokenCount: 0,
  isStreaming: false,
  error: null
})

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isDeliberating: false,
  currentPhase: null,
  currentPrompt: null,
  totalCost: 0,

  agentStreams: {},
  debateStreams: {},
  synthesisStream: emptyStream(),

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

  startDeliberation: (prompt: string) => {
    set({ isDeliberating: true, currentPhase: 'initial', currentPrompt: prompt })
    get().resetStreams()
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
      set((state) => ({
        debateStreams: {
          ...state.debateStreams,
          [provider]: {
            ...(state.debateStreams[provider] || emptyStream()),
            content: (state.debateStreams[provider]?.content || '') + delta,
            isStreaming: true
          }
        }
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
      set((state) => ({
        debateStreams: {
          ...state.debateStreams,
          [provider]: { content: fullContent, tokenCount, isStreaming: false, error: null }
        }
      }))
    } else if (phase === 'synthesis') {
      set({
        synthesisStream: { content: fullContent, tokenCount, isStreaming: false, error: null },
        isDeliberating: false
      })
      get().reloadMessages()
    }
  },

  handleStreamError: (error) => {
    const { provider, message } = error
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
  },

  handlePhaseChange: (phase) => {
    set({ currentPhase: phase.phase })
  },

  endDeliberation: () => {
    set({ isDeliberating: false, currentPhase: null, currentPrompt: null })
  },

  resetStreams: () => {
    set({
      agentStreams: {},
      debateStreams: {},
      synthesisStream: emptyStream(),
      currentPhase: null,
      totalCost: 0
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
} as SessionState & { reloadMessages: () => Promise<void> }))
