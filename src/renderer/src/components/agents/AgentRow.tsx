import React, { useCallback } from 'react'
import { useAgentsStore, type OllamaStatus } from '@renderer/stores/agentsStore'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { PROVIDER_DOT_COLORS, PROVIDER_LABELS } from '@renderer/lib/providers'
import { Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { AgentConfig, ProviderName } from '@shared/types'
import type { CloudProvider } from './AgentsDialog'

const ALL_PROVIDERS: ProviderName[] = ['openai', 'anthropic', 'google', 'ollama']

interface AgentRowProps {
  agent: AgentConfig
  keyPresence: Record<CloudProvider, boolean>
  availableModels: Record<ProviderName, string[]>
  ollamaStatus: OllamaStatus
}

export function AgentRow({
  agent,
  keyPresence,
  availableModels,
  ollamaStatus
}: AgentRowProps): React.JSX.Element {
  const { synthesizerAgentId, updateAgent, removeAgent, setSynthesizer } = useAgentsStore()

  const isSynthesizer = synthesizerAgentId === agent.id
  const models = availableModels[agent.provider]

  const providerDisabled = (p: ProviderName): boolean =>
    p === 'ollama'
      ? ollamaStatus !== 'connected' && availableModels.ollama.length === 0
      : !keyPresence[p]

  const handleProviderChange = useCallback(
    (value: string) => {
      const provider = value as ProviderName
      // Switching provider invalidates the model — jump to the first available
      updateAgent(agent.id, { provider, model: availableModels[provider][0] ?? '' })
    },
    [agent.id, availableModels, updateAgent]
  )

  const handleRemove = useCallback(() => {
    if (confirm(`Remove agent "${agent.name}"?`)) {
      removeAgent(agent.id)
    }
  }, [agent.id, agent.name, removeAgent])

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${PROVIDER_DOT_COLORS[agent.provider]}`} />
        {/* The name is derived from provider:model — it can never drift */}
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{agent.name}</span>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', isSynthesizer && 'text-primary')}
          onClick={() => setSynthesizer(agent.id)}
          title={isSynthesizer ? 'This agent is the synthesizer' : 'Make this agent the synthesizer'}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={agent.enabled ? 'default' : 'outline'}
          size="sm"
          className="h-7 w-20 text-xs"
          onClick={() => updateAgent(agent.id, { enabled: !agent.enabled })}
        >
          {agent.enabled ? 'Enabled' : 'Disabled'}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRemove} title="Remove agent">
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Provider</label>
          <Select value={agent.provider} onValueChange={handleProviderChange}>
            <SelectTrigger className="h-8 text-xs">
              {/* SelectValue shows the raw value — render the label instead */}
              <span>{PROVIDER_LABELS[agent.provider]}</span>
            </SelectTrigger>
            <SelectContent>
              {ALL_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p} disabled={p !== agent.provider && providerDisabled(p)}>
                  {PROVIDER_LABELS[p]}
                  {p !== agent.provider && providerDisabled(p) && (p === 'ollama' ? ' (unreachable)' : ' (no key)')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Model</label>
          {models.length > 0 ? (
            <Select value={agent.model} onValueChange={(v) => updateAgent(agent.id, { model: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent className="max-h-52">
                {models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={agent.model}
              onChange={(e) => updateAgent(agent.id, { model: e.target.value })}
              className="h-8 text-xs"
              placeholder="Model name"
            />
          )}
        </div>
      </div>
    </div>
  )
}
