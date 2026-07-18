import { describe, expect, it } from 'vitest'
import type { AgentConfig } from '@shared/types'
import { agentDisplayName, resolveAgentMeta } from './providers'

const agent = (partial: Partial<AgentConfig> & Pick<AgentConfig, 'name' | 'provider'>): AgentConfig => ({
  id: 'id-' + partial.name,
  model: '',
  enabled: true,
  ...partial
})

describe('agentDisplayName', () => {
  it('joins provider and model with a colon when a model is set', () => {
    expect(agentDisplayName('openai', 'gpt-4o')).toBe('openai:gpt-4o')
    expect(agentDisplayName('ollama', 'llama3.2')).toBe('ollama:llama3.2')
  })

  it('falls back to the provider label when the model is empty', () => {
    expect(agentDisplayName('openai', '')).toBe('OpenAI')
    expect(agentDisplayName('anthropic', '')).toBe('Anthropic')
    expect(agentDisplayName('google', '')).toBe('Google')
    expect(agentDisplayName('ollama', '')).toBe('Ollama')
  })
})

describe('resolveAgentMeta', () => {
  const liveAgents: AgentConfig[] = [
    agent({ name: 'ollama:llama3.2', provider: 'ollama', model: 'llama3.2' }),
    agent({ name: 'openai:gpt-4o', provider: 'openai', model: 'gpt-4o' })
  ]

  it('trusts the provider column when present, keeping the stored name', () => {
    expect(resolveAgentMeta('My Agent', 'google', liveAgents)).toEqual({
      displayName: 'My Agent',
      provider: 'google'
    })
  })

  it('provider column wins even over a conflicting live agent with the same name', () => {
    // 'ollama:llama3.2' exists in liveAgents as an ollama agent, but the row says anthropic
    expect(resolveAgentMeta('ollama:llama3.2', 'anthropic', liveAgents)).toEqual({
      displayName: 'ollama:llama3.2',
      provider: 'anthropic'
    })
  })

  it('uses the provider label when the provider column is set but the name is null', () => {
    expect(resolveAgentMeta(null, 'anthropic', liveAgents)).toEqual({
      displayName: 'Anthropic',
      provider: 'anthropic'
    })
  })

  it('looks up a live agent by name when the provider column is null', () => {
    expect(resolveAgentMeta('ollama:llama3.2', null, liveAgents)).toEqual({
      displayName: 'ollama:llama3.2',
      provider: 'ollama'
    })
  })

  it('live-agent lookup beats the legacy provider-name mapping', () => {
    // A live agent literally named 'openai' resolves to that agent's provider,
    // not to the legacy openai mapping
    const agents = [agent({ name: 'openai', provider: 'google', model: 'gemini-1.5-pro' })]
    expect(resolveAgentMeta('openai', null, agents)).toEqual({
      displayName: 'openai',
      provider: 'google'
    })
  })

  it('maps legacy provider-name rows to the provider label', () => {
    expect(resolveAgentMeta('openai', null, [])).toEqual({
      displayName: 'OpenAI',
      provider: 'openai'
    })
    expect(resolveAgentMeta('anthropic', null, [])).toEqual({
      displayName: 'Anthropic',
      provider: 'anthropic'
    })
    expect(resolveAgentMeta('google', null, [])).toEqual({
      displayName: 'Google',
      provider: 'google'
    })
  })

  it('does not treat "ollama" as a legacy provider name', () => {
    // ollama is absent from LEGACY_PROVIDER_NAMES, so it hits the generic fallback
    expect(resolveAgentMeta('ollama', null, [])).toEqual({
      displayName: 'ollama',
      provider: 'openai'
    })
  })

  it('falls back to the raw name with an openai provider for unknown rows', () => {
    expect(resolveAgentMeta('Some Old Agent', null, liveAgents)).toEqual({
      displayName: 'Some Old Agent',
      provider: 'openai'
    })
  })

  it('falls back to "Agent"/openai when both name and provider are null', () => {
    expect(resolveAgentMeta(null, null, liveAgents)).toEqual({
      displayName: 'Agent',
      provider: 'openai'
    })
  })
})
