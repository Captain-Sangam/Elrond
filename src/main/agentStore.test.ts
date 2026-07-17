import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAgents,
  getOllamaBaseUrl,
  getSynthesizerAgentId,
  saveAgents,
  seedAgentsIfNeeded
} from './agentStore'
import { getDb } from './db'
import { getApiKey } from './keychain'
import { runMigrations } from './db/schema'
import type { AgentConfig } from '../shared/types'

vi.mock('./db', () => ({ getDb: vi.fn() }))
vi.mock('./keychain', () => ({
  getApiKey: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  findCredentialAccounts: vi.fn()
}))

const getDbMock = vi.mocked(getDb)
const getApiKeyMock = vi.mocked(getApiKey)

let db: Database.Database

function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Agent One',
    provider: 'openai',
    model: 'gpt-4o',
    enabled: true,
    ...overrides
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  getDbMock.mockReturnValue(db)
  getApiKeyMock.mockResolvedValue(null)
})

afterEach(() => {
  db.close()
})

describe('getAgents', () => {
  it('returns [] when the agents setting is missing', () => {
    expect(getAgents()).toEqual([])
  })

  it('returns [] for malformed JSON', () => {
    setSetting('agents', '{not valid json')
    expect(getAgents()).toEqual([])
  })

  it('returns [] when the stored value is not an array', () => {
    setSetting('agents', '{"id":"a","name":"A"}')
    expect(getAgents()).toEqual([])
  })

  it('filters out invalid entries and keeps valid ones', () => {
    const valid = agent()
    const entries: unknown[] = [
      valid,
      { ...agent(), id: '' }, // empty id
      { ...agent(), id: 'a2', name: '   ' }, // blank name
      { ...agent(), id: 'a3', provider: 'mistral' }, // unknown provider
      { ...agent(), id: 'a4', model: '' }, // empty model
      { ...agent(), id: 'a5', enabled: 'yes' }, // non-boolean enabled
      { ...agent(), id: 42 }, // non-string id
      null,
      'not-an-object',
      7
    ]
    setSetting('agents', JSON.stringify(entries))

    expect(getAgents()).toEqual([valid])
  })
})

describe('saveAgents', () => {
  it('round-trips valid agents through the settings table', () => {
    const agents = [
      agent({ id: 'a1', name: 'GPT', provider: 'openai', model: 'gpt-4o' }),
      agent({ id: 'a2', name: 'Claude', provider: 'anthropic', model: 'claude-3', enabled: false })
    ]
    saveAgents(agents)
    expect(getAgents()).toEqual(agents)
  })

  it('throws on an invalid agent', () => {
    expect(() => saveAgents([agent({ id: '' })])).toThrow('Invalid agent configuration')
  })

  it('throws on duplicate ids', () => {
    expect(() =>
      saveAgents([agent({ id: 'dup', name: 'One' }), agent({ id: 'dup', name: 'Two' })])
    ).toThrow('Agent ids and names must be unique')
  })

  it('throws on names that collide after trimming and lowercasing', () => {
    expect(() =>
      saveAgents([agent({ id: 'a1', name: 'GPT' }), agent({ id: 'a2', name: '  gpt ' })])
    ).toThrow('Agent ids and names must be unique')
  })
})

describe('getOllamaBaseUrl', () => {
  it('falls back to the default when the setting is unset', () => {
    deleteSetting('ollama_base_url')
    expect(getOllamaBaseUrl()).toBe('http://localhost:11434')
  })

  it('strips trailing slashes from the stored URL', () => {
    setSetting('ollama_base_url', 'http://mac-mini:11434///')
    expect(getOllamaBaseUrl()).toBe('http://mac-mini:11434')
  })

  it('normalizes a whitespace-only value to the default', () => {
    setSetting('ollama_base_url', '   ')
    expect(getOllamaBaseUrl()).toBe('http://localhost:11434')
  })
})

describe('seedAgentsIfNeeded', () => {
  function setLegacyModels(): void {
    setSetting('openai_model', 'gpt-x')
    setSetting('anthropic_model', 'claude-x')
    setSetting('google_model', 'gemini-x')
  }

  it('is a no-op when the agents setting already exists', async () => {
    setSetting('agents', '[]')
    await seedAgentsIfNeeded()

    expect(getApiKeyMock).not.toHaveBeenCalled()
    expect(getSetting('agents')).toBe('[]')
    expect(getSynthesizerAgentId()).toBeNull()
  })

  it('seeds one enabled agent per cloud provider from legacy model settings when no keys exist', async () => {
    setLegacyModels()
    await seedAgentsIfNeeded()

    const agents = getAgents()
    expect(agents.map((a) => a.provider)).toEqual(['openai', 'anthropic', 'google'])
    expect(agents.map((a) => a.model)).toEqual(['gpt-x', 'claude-x', 'gemini-x'])
    // Names are derived provider:model labels
    expect(agents.map((a) => a.name)).toEqual([
      'openai:gpt-x',
      'anthropic:claude-x',
      'google:gemini-x'
    ])
    // Fresh installs (no keys) keep every provider enabled
    expect(agents.every((a) => a.enabled)).toBe(true)
    expect(new Set(agents.map((a) => a.id)).size).toBe(3)

    // Legacy synthesizer defaults to anthropic
    const anthropicAgent = agents.find((a) => a.provider === 'anthropic')!
    expect(getSynthesizerAgentId()).toBe(anthropicAgent.id)
  })

  it('enables only providers with API keys when at least one key exists', async () => {
    setLegacyModels()
    getApiKeyMock.mockImplementation(async (provider: string) =>
      provider === 'openai' ? 'sk-live' : null
    )

    await seedAgentsIfNeeded()

    expect(getApiKeyMock).toHaveBeenCalledWith('openai')
    expect(getApiKeyMock).toHaveBeenCalledWith('anthropic')
    expect(getApiKeyMock).toHaveBeenCalledWith('google')

    const agents = getAgents()
    const enabledByProvider = Object.fromEntries(agents.map((a) => [a.provider, a.enabled]))
    expect(enabledByProvider).toEqual({ openai: true, anthropic: false, google: false })

    // Legacy synthesizer (anthropic) is disabled, so the first enabled agent wins
    const openaiAgent = agents.find((a) => a.provider === 'openai')!
    expect(getSynthesizerAgentId()).toBe(openaiAgent.id)
  })

  it('skips providers whose legacy model setting is missing', async () => {
    setLegacyModels()
    deleteSetting('google_model')

    await seedAgentsIfNeeded()

    expect(getAgents().map((a) => a.provider)).toEqual(['openai', 'anthropic'])
  })

  it('honors a legacy synthesizer setting other than anthropic', async () => {
    setLegacyModels()
    setSetting('synthesizer', 'google')

    await seedAgentsIfNeeded()

    const googleAgent = getAgents().find((a) => a.provider === 'google')!
    expect(getSynthesizerAgentId()).toBe(googleAgent.id)
  })

  it('persists an empty agent list and no synthesizer when no legacy models exist', async () => {
    deleteSetting('openai_model')
    deleteSetting('anthropic_model')
    deleteSetting('google_model')

    await seedAgentsIfNeeded()

    expect(getSetting('agents')).toBe('[]')
    expect(getSynthesizerAgentId()).toBeNull()
  })
})
