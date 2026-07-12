import { create } from 'zustand'
import type { AgentConfig, ProviderName } from '@shared/types'
import { PROVIDER_LABELS } from '@renderer/lib/providers'

export type OllamaStatus = 'idle' | 'testing' | 'connected' | 'error'

interface AgentsState {
  agents: AgentConfig[]
  synthesizerAgentId: string | null
  loaded: boolean

  ollamaBaseUrl: string
  ollamaStatus: OllamaStatus
  ollamaModels: string[]

  loadAgents: () => Promise<void>
  addAgent: (partial?: Partial<Omit<AgentConfig, 'id'>>) => void
  updateAgent: (id: string, updates: Partial<Omit<AgentConfig, 'id'>>) => void
  removeAgent: (id: string) => void
  setSynthesizer: (id: string) => void
  setOllamaBaseUrl: (url: string) => void
  testOllama: () => Promise<boolean>
}

// Agents address each other by name in debate prompts, so names must stay
// unique — collisions get a numeric suffix instead of erroring
function uniqueName(desired: string, agents: AgentConfig[], excludeId?: string): string {
  const base = desired.trim() || 'Agent'
  const taken = new Set(
    agents.filter((a) => a.id !== excludeId).map((a) => a.name.trim().toLowerCase())
  )
  if (!taken.has(base.toLowerCase())) return base
  let i = 2
  while (taken.has(`${base} ${i}`.toLowerCase())) i++
  return `${base} ${i}`
}

export const enabledAgents = (state: Pick<AgentsState, 'agents'>): AgentConfig[] =>
  state.agents.filter((a) => a.enabled)

// The configured synthesizer if it can actually run, else the first enabled
// agent — mirrors the orchestrator's runtime fallback
export const effectiveSynthesizer = (
  state: Pick<AgentsState, 'agents' | 'synthesizerAgentId'>
): AgentConfig | null => {
  const enabled = enabledAgents(state)
  return enabled.find((a) => a.id === state.synthesizerAgentId) ?? enabled[0] ?? null
}

export const useAgentsStore = create<AgentsState>((set, get) => {
  const persistAgents = (agents: AgentConfig[]): void => {
    window.elrond.saveAgents(agents).catch((err) => {
      console.error('Failed to save agents:', err)
    })
  }

  return {
    agents: [],
    synthesizerAgentId: null,
    loaded: false,

    ollamaBaseUrl: 'http://localhost:11434',
    ollamaStatus: 'idle',
    ollamaModels: [],

    loadAgents: async () => {
      const [agents, settings] = await Promise.all([
        window.elrond.getAgents(),
        window.elrond.getAllSettings()
      ])
      set({
        agents,
        synthesizerAgentId: settings.synthesizer_agent_id || null,
        ollamaBaseUrl: settings.ollama_base_url || 'http://localhost:11434',
        loaded: true
      })
    },

    addAgent: (partial) => {
      const { agents } = get()
      const provider: ProviderName = partial?.provider ?? 'openai'
      const agent: AgentConfig = {
        id: crypto.randomUUID(),
        name: uniqueName(partial?.name ?? PROVIDER_LABELS[provider], agents),
        provider,
        model: partial?.model ?? '',
        enabled: partial?.enabled ?? true
      }
      const next = [...agents, agent]
      set({ agents: next })
      persistAgents(next)
      if (!get().synthesizerAgentId) {
        get().setSynthesizer(agent.id)
      }
    },

    updateAgent: (id, updates) => {
      const { agents } = get()
      const next = agents.map((a) => {
        if (a.id !== id) return a
        const merged = { ...a, ...updates }
        if (updates.name !== undefined) {
          merged.name = uniqueName(updates.name, agents, id)
        }
        return merged
      })
      set({ agents: next })
      persistAgents(next)
    },

    removeAgent: (id) => {
      const { agents, synthesizerAgentId } = get()
      const next = agents.filter((a) => a.id !== id)
      set({ agents: next })
      persistAgents(next)
      if (synthesizerAgentId === id) {
        const fallback = next.find((a) => a.enabled) ?? next[0]
        if (fallback) {
          get().setSynthesizer(fallback.id)
        } else {
          set({ synthesizerAgentId: null })
          window.elrond.setSetting('synthesizer_agent_id', '')
        }
      }
    },

    setSynthesizer: (id) => {
      set({ synthesizerAgentId: id })
      window.elrond.setSetting('synthesizer_agent_id', id)
    },

    setOllamaBaseUrl: (url) => {
      set({ ollamaBaseUrl: url, ollamaStatus: 'idle' })
      window.elrond.setSetting('ollama_base_url', url)
    },

    testOllama: async () => {
      const url = get().ollamaBaseUrl
      set({ ollamaStatus: 'testing' })
      const ok = await window.elrond.testOllamaConnection(url)
      if (get().ollamaBaseUrl !== url) return ok // URL changed mid-test; ignore
      if (!ok) {
        set({ ollamaStatus: 'error' })
        return false
      }
      try {
        const models = await window.elrond.listModels('ollama', url)
        set({ ollamaStatus: 'connected', ollamaModels: models })
      } catch {
        set({ ollamaStatus: 'connected' })
      }
      return true
    }
  }
})
