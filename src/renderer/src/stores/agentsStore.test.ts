import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig } from '@shared/types'
import { effectiveSynthesizer, enabledAgents, useAgentsStore } from './agentsStore'

const agent = (partial: Partial<AgentConfig> & Pick<AgentConfig, 'id'>): AgentConfig => ({
  name: partial.id,
  provider: 'openai',
  model: 'gpt-4o',
  enabled: true,
  ...partial
})

const makeElrond = (): {
  getAgents: ReturnType<typeof vi.fn>
  getAllSettings: ReturnType<typeof vi.fn>
  saveAgents: ReturnType<typeof vi.fn>
  setSetting: ReturnType<typeof vi.fn>
  testOllamaConnection: ReturnType<typeof vi.fn>
  listModels: ReturnType<typeof vi.fn>
} => ({
  getAgents: vi.fn().mockResolvedValue([]),
  getAllSettings: vi.fn().mockResolvedValue({}),
  saveAgents: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  testOllamaConnection: vi.fn().mockResolvedValue(true),
  listModels: vi.fn().mockResolvedValue([])
})

let elrond: ReturnType<typeof makeElrond>

beforeEach(() => {
  useAgentsStore.setState(useAgentsStore.getInitialState(), true)
  elrond = makeElrond()
  vi.stubGlobal('window', { elrond })
})

describe('enabledAgents / effectiveSynthesizer selectors', () => {
  it('enabledAgents keeps only enabled agents', () => {
    const a = agent({ id: 'a' })
    const b = agent({ id: 'b', enabled: false })
    expect(enabledAgents({ agents: [a, b] })).toEqual([a])
  })

  it('returns the configured synthesizer when it is enabled', () => {
    const a = agent({ id: 'a' })
    const b = agent({ id: 'b' })
    expect(effectiveSynthesizer({ agents: [a, b], synthesizerAgentId: 'b' })).toBe(b)
  })

  it('falls back to the first enabled agent when the synthesizer is disabled', () => {
    const a = agent({ id: 'a', enabled: false })
    const b = agent({ id: 'b' })
    expect(effectiveSynthesizer({ agents: [a, b], synthesizerAgentId: 'a' })).toBe(b)
  })

  it('falls back to the first enabled agent when the synthesizer id is stale', () => {
    const a = agent({ id: 'a' })
    expect(effectiveSynthesizer({ agents: [a], synthesizerAgentId: 'deleted' })).toBe(a)
  })

  it('returns null when no agents are enabled', () => {
    const a = agent({ id: 'a', enabled: false })
    expect(effectiveSynthesizer({ agents: [a], synthesizerAgentId: 'a' })).toBeNull()
    expect(effectiveSynthesizer({ agents: [], synthesizerAgentId: null })).toBeNull()
  })
})

describe('addAgent', () => {
  it('creates a default openai agent named from the provider label and persists it', () => {
    useAgentsStore.getState().addAgent()
    const { agents } = useAgentsStore.getState()
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ name: 'OpenAI', provider: 'openai', model: '', enabled: true })
    expect(agents[0].id).toBeTruthy()
    expect(elrond.saveAgents).toHaveBeenCalledWith(agents)
  })

  it('derives the name from provider:model when a model is given', () => {
    useAgentsStore.getState().addAgent({ provider: 'ollama', model: 'llama3.2', enabled: false })
    expect(useAgentsStore.getState().agents[0]).toMatchObject({
      name: 'ollama:llama3.2',
      enabled: false
    })
  })

  it('suffixes duplicate names with " 2", " 3", ...', () => {
    const { addAgent } = useAgentsStore.getState()
    addAgent({ provider: 'ollama', model: 'llama3.2' })
    addAgent({ provider: 'ollama', model: 'llama3.2' })
    addAgent({ provider: 'ollama', model: 'llama3.2' })
    expect(useAgentsStore.getState().agents.map((a) => a.name)).toEqual([
      'ollama:llama3.2',
      'ollama:llama3.2 2',
      'ollama:llama3.2 3'
    ])
  })

  it('makes the first agent the synthesizer and persists the setting', () => {
    useAgentsStore.getState().addAgent()
    const first = useAgentsStore.getState().agents[0]
    expect(useAgentsStore.getState().synthesizerAgentId).toBe(first.id)
    expect(elrond.setSetting).toHaveBeenCalledWith('synthesizer_agent_id', first.id)

    // A second agent does not steal the synthesizer slot
    useAgentsStore.getState().addAgent({ provider: 'google', model: 'gemini-1.5-pro' })
    expect(useAgentsStore.getState().synthesizerAgentId).toBe(first.id)
    expect(elrond.setSetting).toHaveBeenCalledTimes(1)
  })
})

describe('updateAgent', () => {
  it('re-derives the name when the model changes and persists', () => {
    useAgentsStore.setState({ agents: [agent({ id: 'a', name: 'openai:gpt-4o' })] })
    useAgentsStore.getState().updateAgent('a', { model: 'gpt-4o-mini' })
    const updated = useAgentsStore.getState().agents[0]
    expect(updated).toMatchObject({ name: 'openai:gpt-4o-mini', model: 'gpt-4o-mini' })
    expect(elrond.saveAgents).toHaveBeenCalledWith([updated])
  })

  it('re-derives the name when the provider changes', () => {
    useAgentsStore.setState({ agents: [agent({ id: 'a', name: 'openai:gpt-4o' })] })
    useAgentsStore.getState().updateAgent('a', { provider: 'anthropic', model: 'claude-3-opus-20240229' })
    expect(useAgentsStore.getState().agents[0].name).toBe('anthropic:claude-3-opus-20240229')
  })

  it('suffixes the re-derived name when it collides with another agent', () => {
    useAgentsStore.setState({
      agents: [
        agent({ id: 'a', name: 'openai:gpt-4o' }),
        agent({ id: 'b', name: 'openai:gpt-4o-mini', model: 'gpt-4o-mini' })
      ]
    })
    useAgentsStore.getState().updateAgent('b', { model: 'gpt-4o' })
    expect(useAgentsStore.getState().agents[1].name).toBe('openai:gpt-4o 2')
  })

  it('leaves other agents untouched', () => {
    const a = agent({ id: 'a', name: 'openai:gpt-4o' })
    useAgentsStore.setState({ agents: [a, agent({ id: 'b', name: 'openai:gpt-4o 2' })] })
    useAgentsStore.getState().updateAgent('b', { enabled: false })
    expect(useAgentsStore.getState().agents[0]).toEqual(a)
  })
})

describe('removeAgent', () => {
  it('removes the agent and persists the remaining list', () => {
    useAgentsStore.setState({
      agents: [agent({ id: 'a' }), agent({ id: 'b' })],
      synthesizerAgentId: 'a'
    })
    useAgentsStore.getState().removeAgent('b')
    expect(useAgentsStore.getState().agents.map((a) => a.id)).toEqual(['a'])
    expect(elrond.saveAgents).toHaveBeenCalledWith(useAgentsStore.getState().agents)
    // Synthesizer untouched — no setting write
    expect(useAgentsStore.getState().synthesizerAgentId).toBe('a')
    expect(elrond.setSetting).not.toHaveBeenCalled()
  })

  it('reassigns the synthesizer to the first enabled agent and persists it', () => {
    useAgentsStore.setState({
      agents: [agent({ id: 'a' }), agent({ id: 'b', enabled: false }), agent({ id: 'c' })],
      synthesizerAgentId: 'a'
    })
    useAgentsStore.getState().removeAgent('a')
    expect(useAgentsStore.getState().synthesizerAgentId).toBe('c')
    expect(elrond.setSetting).toHaveBeenCalledWith('synthesizer_agent_id', 'c')
  })

  it('falls back to a disabled agent when nothing enabled remains', () => {
    useAgentsStore.setState({
      agents: [agent({ id: 'a' }), agent({ id: 'b', enabled: false })],
      synthesizerAgentId: 'a'
    })
    useAgentsStore.getState().removeAgent('a')
    expect(useAgentsStore.getState().synthesizerAgentId).toBe('b')
    expect(elrond.setSetting).toHaveBeenCalledWith('synthesizer_agent_id', 'b')
  })

  it('clears the synthesizer setting when the last agent is removed', () => {
    useAgentsStore.setState({ agents: [agent({ id: 'a' })], synthesizerAgentId: 'a' })
    useAgentsStore.getState().removeAgent('a')
    expect(useAgentsStore.getState().agents).toEqual([])
    expect(useAgentsStore.getState().synthesizerAgentId).toBeNull()
    expect(elrond.setSetting).toHaveBeenCalledWith('synthesizer_agent_id', '')
  })
})

describe('loadAgents', () => {
  it('loads agents and settings, marking the store loaded', async () => {
    const stored = [agent({ id: 'a', name: 'openai:gpt-4o' })]
    elrond.getAgents.mockResolvedValue(stored)
    elrond.getAllSettings.mockResolvedValue({
      synthesizer_agent_id: 'a',
      ollama_base_url: 'http://ollama.local:11434'
    })

    await useAgentsStore.getState().loadAgents()

    const state = useAgentsStore.getState()
    expect(state.agents).toEqual(stored)
    expect(state.synthesizerAgentId).toBe('a')
    expect(state.ollamaBaseUrl).toBe('http://ollama.local:11434')
    expect(state.loaded).toBe(true)
    // Names were already correct — nothing to persist
    expect(elrond.saveAgents).not.toHaveBeenCalled()
  })

  it('defaults synthesizer and ollama url when settings are absent', async () => {
    await useAgentsStore.getState().loadAgents()
    const state = useAgentsStore.getState()
    expect(state.synthesizerAgentId).toBeNull()
    expect(state.ollamaBaseUrl).toBe('http://localhost:11434')
  })

  it('re-derives stale names and persists the renamed agents', async () => {
    elrond.getAgents.mockResolvedValue([
      agent({ id: 'a', name: 'Old Label', provider: 'openai', model: 'gpt-4o' })
    ])

    await useAgentsStore.getState().loadAgents()

    const [renamed] = useAgentsStore.getState().agents
    expect(renamed.name).toBe('openai:gpt-4o')
    expect(elrond.saveAgents).toHaveBeenCalledWith([renamed])
  })

  it('keeps stable numeric suffixes for duplicate models without re-persisting', async () => {
    elrond.getAgents.mockResolvedValue([
      agent({ id: 'a', name: 'ollama:llama3.2', provider: 'ollama', model: 'llama3.2' }),
      agent({ id: 'b', name: 'ollama:llama3.2 2', provider: 'ollama', model: 'llama3.2' })
    ])

    await useAgentsStore.getState().loadAgents()

    expect(useAgentsStore.getState().agents.map((a) => a.name)).toEqual([
      'ollama:llama3.2',
      'ollama:llama3.2 2'
    ])
    expect(elrond.saveAgents).not.toHaveBeenCalled()
  })
})
