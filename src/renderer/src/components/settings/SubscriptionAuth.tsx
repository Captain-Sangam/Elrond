import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useAgentsStore } from '@renderer/stores/agentsStore'
import { useSessionStore } from '@renderer/stores/sessionStore'
import { Button } from '@renderer/components/ui/button'
import { keepsModelAfterSwitch } from '@renderer/lib/providers'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import type { AuthMode, SubscriptionProvider, SubscriptionStatus } from '@shared/types'
import { CliMcpPicker } from './CliMcpDialog'

const CLI_NAMES: Record<SubscriptionProvider, string> = {
  anthropic: 'Claude Code',
  openai: 'Codex'
}

interface SubscriptionAuthProps {
  provider: SubscriptionProvider
  // Subscription readiness: true once the CLI login is detected, false on any
  // mode change or failed check. `mode` is the mode it applies to, so a parent
  // can keep an already-tested API key valid when switching back to API.
  onReadyChange?: (ready: boolean, mode: AuthMode) => void
  // The API key input — shown only in API mode
  children: React.ReactNode
}

// API key / Subscription switch for one provider. Subscription mode runs the
// vendor's CLI on the user's own login, so "setup" is just checking that the
// CLI is installed and logged in.
export function SubscriptionAuth({ provider, onReadyChange, children }: SubscriptionAuthProps): React.JSX.Element {
  const mode = useSettingsStore((s) => s.authModes[provider])
  const setSetting = useSettingsStore((s) => s.setSetting)
  // A running deliberation keeps its agents' models; switching backends
  // mid-run would send them to a backend that can't run them
  const isDeliberating = useSessionStore((s) => s.isDeliberating)
  const [status, setStatus] = useState<SubscriptionStatus | 'checking' | null>(null)
  const latestCheck = useRef(0)
  const latestSwitch = useRef(0)
  const onReady = useRef(onReadyChange)
  onReady.current = onReadyChange

  const detect = useCallback(async () => {
    const check = ++latestCheck.current
    setStatus('checking')
    const result = await window.elrond.detectSubscription(provider)
    // Superseded by a newer check or a switch back to API
    if (check !== latestCheck.current || useSettingsStore.getState().authModes[provider] !== 'subscription') return
    setStatus(result)
    onReady.current?.(result.ok, 'subscription')
  }, [provider])

  useEffect(() => {
    if (useSettingsStore.getState().authModes[provider] === 'subscription') detect()
  }, [provider, detect])

  const switchMode = useCallback(
    async (next: AuthMode) => {
      if (next === mode) return
      const switchId = ++latestSwitch.current
      latestCheck.current++
      setStatus(null)
      onReady.current?.(false, next)
      await setSetting(`${provider}_auth`, next)
      if (next === 'subscription') detect()

      // Move agents off models the new backend can't run
      const key = next === 'api' ? await window.elrond.getApiKey(provider) : null
      const models = await window.elrond.listModels(provider, key ?? undefined).catch(() => [] as string[])
      // A newer switch started while this list loaded (e.g. API → Subscription
      // → API) — its own remap wins; this list may belong to the wrong mode
      if (switchId !== latestSwitch.current) return
      const { agents, updateAgent } = useAgentsStore.getState()
      for (const agent of agents) {
        if (agent.provider === provider && !keepsModelAfterSwitch(agent.model, models, provider, next)) {
          updateAgent(agent.id, { model: models[0] })
        }
      }
    },
    [mode, provider, setSetting, detect]
  )

  const failed = status !== null && status !== 'checking' && !status.ok

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {(['api', 'subscription'] as const).map((m) => (
          <Button
            key={m}
            variant={mode === m ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            disabled={isDeliberating}
            title={isDeliberating ? 'Wait for the current deliberation to finish' : undefined}
            onClick={() => switchMode(m)}
          >
            {m === 'api' ? 'API key' : 'Subscription'}
          </Button>
        ))}
      </div>
      {mode === 'api' ? (
        children
      ) : (
        <>
          <div className="flex items-center gap-2 text-[11px]">
            {status === 'checking' && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
            {status !== null && status !== 'checking' && status.ok && <Check className="h-3 w-3 shrink-0 text-success" />}
            {failed && <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />}
            <span className={failed ? 'text-destructive' : 'text-muted-foreground'}>
              {status === 'checking'
                ? `Looking for your ${CLI_NAMES[provider]} login…`
                : (status?.detail ?? `Uses your ${CLI_NAMES[provider]} login`)}
            </span>
            <button
              onClick={detect}
              disabled={status === 'checking'}
              className="ml-auto shrink-0 text-primary underline decoration-primary/30 underline-offset-2 disabled:opacity-50"
            >
              Re-check
            </button>
          </div>
          <CliMcpPicker provider={provider} cli={CLI_NAMES[provider]} />
        </>
      )}
    </div>
  )
}
