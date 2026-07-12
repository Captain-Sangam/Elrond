import { getDb } from './db'
import { getApiKey } from './keychain'
import { DEFAULT_OLLAMA_BASE_URL, normalizeBaseUrl } from './orchestrator/providers/ollama'
import type { AgentConfig, ProviderName } from '../shared/types'
import { v4 as uuidv4 } from 'uuid'

const CLOUD_PROVIDERS: { name: Exclude<ProviderName, 'ollama'>; label: string }[] = [
  { name: 'openai', label: 'OpenAI' },
  { name: 'anthropic', label: 'Anthropic' },
  { name: 'google', label: 'Google' }
]

const PROVIDER_NAMES: ProviderName[] = ['openai', 'anthropic', 'google', 'ollama']

function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

function isValidAgent(a: unknown): a is AgentConfig {
  if (typeof a !== 'object' || a === null) return false
  const agent = a as Record<string, unknown>
  return (
    typeof agent.id === 'string' &&
    agent.id.length > 0 &&
    typeof agent.name === 'string' &&
    agent.name.trim().length > 0 &&
    PROVIDER_NAMES.includes(agent.provider as ProviderName) &&
    typeof agent.model === 'string' &&
    agent.model.length > 0 &&
    typeof agent.enabled === 'boolean'
  )
}

export function getAgents(): AgentConfig[] {
  const raw = getSetting('agents')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidAgent)
  } catch {
    return []
  }
}

export function saveAgents(agents: AgentConfig[]): void {
  if (!Array.isArray(agents) || !agents.every(isValidAgent)) {
    throw new Error('Invalid agent configuration')
  }
  const ids = new Set(agents.map((a) => a.id))
  const names = new Set(agents.map((a) => a.name.trim().toLowerCase()))
  // Unique names keep debate/synthesis prompts unambiguous — agents address
  // each other purely by name
  if (ids.size !== agents.length || names.size !== agents.length) {
    throw new Error('Agent ids and names must be unique')
  }
  setSetting('agents', JSON.stringify(agents))
}

export function getOllamaBaseUrl(): string {
  return normalizeBaseUrl(getSetting('ollama_base_url') ?? DEFAULT_OLLAMA_BASE_URL)
}

export function getSynthesizerAgentId(): string | null {
  return getSetting('synthesizer_agent_id')
}

// One-time upgrade: synthesize agent slots from the pre-decoupling settings
// (one per cloud provider) so existing installs keep behaving identically.
export async function seedAgentsIfNeeded(): Promise<void> {
  if (getSetting('agents') !== null) return

  const keyed = await Promise.all(CLOUD_PROVIDERS.map(async (p) => Boolean(await getApiKey(p.name))))
  const anyKeys = keyed.some(Boolean)

  const agents: AgentConfig[] = CLOUD_PROVIDERS.map((p, i) => ({
    id: uuidv4(),
    name: p.label,
    provider: p.name,
    model: getSetting(`${p.name}_model`) ?? '',
    // Fresh installs (no keys yet) keep every provider on, matching the old
    // default; upgrades enable only the providers that can actually run
    enabled: anyKeys ? keyed[i] : true
  })).filter((a) => a.model !== '')

  saveAgents(agents)

  const legacySynthesizer = getSetting('synthesizer') ?? 'anthropic'
  const synthesizer =
    agents.find((a) => a.provider === legacySynthesizer && a.enabled) ??
    agents.find((a) => a.enabled) ??
    agents[0]
  if (synthesizer) {
    setSetting('synthesizer_agent_id', synthesizer.id)
  }
}
