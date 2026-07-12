import React, { useCallback } from 'react'
import { effectiveSynthesizer, useAgentsStore } from '@renderer/stores/agentsStore'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { PROVIDER_LABELS } from '@renderer/lib/providers'
import { AlertTriangle, Plus } from 'lucide-react'
import type { ProviderName } from '@shared/types'
import { AgentRow } from './AgentRow'
import type { CloudProvider } from './AgentsDialog'

interface AssignmentsTabProps {
  keyPresence: Record<CloudProvider, boolean>
  availableModels: Record<ProviderName, string[]>
}

export function AssignmentsTab({
  keyPresence,
  availableModels
}: AssignmentsTabProps): React.JSX.Element {
  const { agents, synthesizerAgentId, addAgent, setSynthesizer, ollamaStatus } = useAgentsStore()
  const synthesizer = effectiveSynthesizer({ agents, synthesizerAgentId })
  const configuredSynthesizer = agents.find((a) => a.id === synthesizerAgentId)

  const handleAdd = useCallback(() => {
    // Default the new agent to the first provider that can actually run
    const provider: ProviderName =
      ollamaStatus === 'connected' && availableModels.ollama.length > 0
        ? 'ollama'
        : (['openai', 'anthropic', 'google'] as const).find((p) => keyPresence[p]) ?? 'openai'
    addAgent({
      provider,
      name: PROVIDER_LABELS[provider],
      model: availableModels[provider][0] ?? ''
    })
  }, [addAgent, availableModels, keyPresence, ollamaStatus])

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Agents</h3>
            <p className="text-xs text-muted-foreground">
              Each agent answers independently, then they debate. Several agents can share a
              provider — e.g. two local Ollama models arguing it out.
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1" onClick={handleAdd}>
            <Plus className="h-3 w-3" />
            Add agent
          </Button>
        </div>

        {agents.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            No agents configured. Add one to start deliberating.
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                keyPresence={keyPresence}
                availableModels={availableModels}
                ollamaStatus={ollamaStatus}
              />
            ))}
          </div>
        )}
      </section>

      {agents.length > 0 && (
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-medium">Synthesizer</h3>
            <p className="text-xs text-muted-foreground">
              This agent moderates debates and writes the final answer.
            </p>
          </div>
          <Select value={synthesizerAgentId ?? ''} onValueChange={(v) => setSynthesizer(v)}>
            <SelectTrigger className="h-8 text-xs">
              {/* SelectValue would show the raw agent id — render the name instead */}
              <span className={configuredSynthesizer ? '' : 'text-muted-foreground'}>
                {configuredSynthesizer?.name ?? 'Select an agent'}
              </span>
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                  {!a.enabled && ' (disabled)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {configuredSynthesizer && !configuredSynthesizer.enabled && synthesizer && (
            <p className="flex items-center gap-1 text-[10px] text-amber-400">
              <AlertTriangle className="h-2.5 w-2.5" />
              {configuredSynthesizer.name} is disabled — {synthesizer.name} will synthesize instead
            </p>
          )}
        </section>
      )}
    </div>
  )
}
