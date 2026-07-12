import React from 'react'
import { useAgentsStore } from '@renderer/stores/agentsStore'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { PROVIDER_DOT_COLORS, PROVIDER_LABELS } from '@renderer/lib/providers'
import { Loader2, RefreshCw } from 'lucide-react'
import { CLOUD_PROVIDER_LIST, type CloudProvider } from './AgentsDialog'

interface ProvidersTabProps {
  keyPresence: Record<CloudProvider, boolean>
  cloudModels: Record<CloudProvider, string[]>
  onOpenSettings?: () => void
}

export function ProvidersTab({
  keyPresence,
  cloudModels,
  onOpenSettings
}: ProvidersTabProps): React.JSX.Element {
  const { agents, ollamaBaseUrl, ollamaStatus, ollamaModels, testOllama } = useAgentsStore()

  const agentCount = (provider: string): number =>
    agents.filter((a) => a.provider === provider).length

  const usageLabel = (provider: string): string => {
    const n = agentCount(provider)
    return n === 0 ? 'No agents' : n === 1 ? '1 agent' : `${n} agents`
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Cloud</h3>
        {CLOUD_PROVIDER_LIST.map((name) => (
          <div key={name} className="flex items-center gap-2 rounded-lg border p-3">
            <span className={`h-2 w-2 shrink-0 rounded-full ${PROVIDER_DOT_COLORS[name]}`} />
            <span className="text-sm font-medium">{PROVIDER_LABELS[name]}</span>
            {keyPresence[name] ? (
              <Badge className="border-green-500/30 bg-green-500/10 text-[9px] text-green-400">
                Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                No key
              </Badge>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {usageLabel(name)}
              {cloudModels[name].length > 0 && ` · ${cloudModels[name].length} models`}
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Local</h3>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${PROVIDER_DOT_COLORS.ollama}`} />
            <span className="text-sm font-medium">Ollama</span>
            {ollamaStatus === 'testing' ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : ollamaStatus === 'connected' ? (
              <Badge className="border-green-500/30 bg-green-500/10 text-[9px] text-green-400">
                Connected
              </Badge>
            ) : ollamaStatus === 'error' ? (
              <Badge variant="outline" className="border-destructive/30 text-[9px] text-destructive">
                Unreachable
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                Not tested
              </Badge>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">{usageLabel('ollama')}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => testOllama()}
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">{ollamaBaseUrl}</div>
          {ollamaModels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ollamaModels.map((m) => (
                <Badge key={m} variant="outline" className="text-[9px]">
                  {m}
                </Badge>
              ))}
              {ollamaStatus === 'error' && (
                <span className="text-[10px] text-muted-foreground">(cached)</span>
              )}
            </div>
          )}
          {ollamaStatus === 'error' && ollamaModels.length === 0 && (
            <p className="text-[10px] text-destructive">
              Cannot reach the server — is <span className="font-mono">ollama serve</span> running?
            </p>
          )}
        </div>
      </section>

      <p className="text-[10px] text-muted-foreground">
        Manage API keys and the Ollama server URL in{' '}
        {onOpenSettings ? (
          <button
            onClick={onOpenSettings}
            className="text-primary underline decoration-primary/30 underline-offset-2"
          >
            Settings
          </button>
        ) : (
          'Settings'
        )}
        .
      </p>
    </div>
  )
}
