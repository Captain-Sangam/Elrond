import type { AgentConfig, ProviderName } from '@shared/types'

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  ollama: 'Ollama'
}

// Colors follow the provider, not the agent — two Ollama agents share purple
// and are told apart by their names
export const PROVIDER_COLORS: Record<ProviderName, string> = {
  openai: 'bg-green-500/10 text-green-400 border-green-500/20',
  anthropic: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  google: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  ollama: 'bg-purple-500/10 text-purple-400 border-purple-500/20'
}

export const PROVIDER_DOT_COLORS: Record<ProviderName, string> = {
  openai: 'bg-green-400',
  anthropic: 'bg-orange-400',
  google: 'bg-blue-400',
  ollama: 'bg-purple-400'
}

export const CLOUD_PROVIDERS: Exclude<ProviderName, 'ollama'>[] = ['openai', 'anthropic', 'google']

const LEGACY_PROVIDER_NAMES: ProviderName[] = ['openai', 'anthropic', 'google']

// Agent names are never hand-written — always derived from what the agent
// actually runs, so a provider/model change can't leave a stale label behind
export function agentDisplayName(provider: ProviderName, model: string): string {
  return model ? `${provider}:${model}` : PROVIDER_LABELS[provider]
}

export interface AgentMeta {
  displayName: string
  provider: ProviderName
}

// Resolves a persisted messages.agent_name to display metadata. New rows store
// the agent display name (with agent_id/provider columns alongside); rows from
// before the agent/provider decoupling stored the provider name itself.
export function resolveAgentMeta(
  agentName: string | null,
  provider: ProviderName | null,
  agents: AgentConfig[]
): AgentMeta {
  if (provider) {
    return { displayName: agentName || PROVIDER_LABELS[provider], provider }
  }
  const live = agentName ? agents.find((a) => a.name === agentName) : undefined
  if (live) {
    return { displayName: live.name, provider: live.provider }
  }
  if (agentName && LEGACY_PROVIDER_NAMES.includes(agentName as ProviderName)) {
    const legacy = agentName as ProviderName
    return { displayName: PROVIDER_LABELS[legacy], provider: legacy }
  }
  return { displayName: agentName || 'Agent', provider: 'openai' }
}
