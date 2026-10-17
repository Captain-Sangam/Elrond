import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useAgentsStore } from '@renderer/stores/agentsStore'
import { useSessionStore } from '@renderer/stores/sessionStore'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { keepsModelAfterSwitch } from '@renderer/lib/providers'
import { AlertTriangle, Check, ChevronRight, Loader2, X } from 'lucide-react'
import type { AuthMode, CliMcpServer, SubscriptionProvider, SubscriptionStatus } from '@shared/types'

const CLI_NAMES: Record<SubscriptionProvider, string> = {
  anthropic: 'Claude Code',
  openai: 'Codex'
}

interface SubscriptionAuthProps {
  provider: SubscriptionProvider
  // Subscription readiness: true once the CLI login is detected, false on any
  // mode change or failed check (API mode reports readiness via the key test)
  onReadyChange?: (ready: boolean) => void
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
  const onReady = useRef(onReadyChange)
  onReady.current = onReadyChange

  const detect = useCallback(async () => {
    const check = ++latestCheck.current
    setStatus('checking')
    const result = await window.elrond.detectSubscription(provider)
    // Superseded by a newer check or a switch back to API
    if (check !== latestCheck.current || useSettingsStore.getState().authModes[provider] !== 'subscription') return
    setStatus(result)
    onReady.current?.(result.ok)
  }, [provider])

  useEffect(() => {
    if (useSettingsStore.getState().authModes[provider] === 'subscription') detect()
  }, [provider, detect])

  const switchMode = useCallback(
    async (next: AuthMode) => {
      if (next === mode) return
      latestCheck.current++
      setStatus(null)
      onReady.current?.(false)
      await setSetting(`${provider}_auth`, next)
      if (next === 'subscription') detect()

      // Move agents off models the new backend can't run
      const key = next === 'api' ? await window.elrond.getApiKey(provider) : null
      const models = await window.elrond.listModels(provider, key ?? undefined).catch(() => [] as string[])
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
          <CliMcpPicker provider={provider} />
        </>
      )}
    </div>
  )
}

// Opt-in to MCP servers from the user's own CLI setup: a status line here,
// the two-column chooser in its own dialog. Headless runs can't show approval
// prompts, so a chosen server's tools run without asking — hence nothing is
// chosen by default.
function CliMcpPicker({ provider }: { provider: SubscriptionProvider }): React.JSX.Element {
  const settingKey = `${provider}_cli_mcp`
  const cli = CLI_NAMES[provider]
  const [selected, setSelected] = useState<string[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    window.elrond.getSetting(settingKey).then((raw) => {
      try {
        const names = JSON.parse(raw ?? '[]')
        if (Array.isArray(names)) setSelected(names.filter((n): n is string => typeof n === 'string'))
      } catch {
        // unreadable setting reads as nothing selected
      }
    })
  }, [settingKey])

  const save = (next: string[]): void => {
    setSelected(next)
    window.elrond.setSetting(settingKey, JSON.stringify(next))
  }

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={selected.length ? 'text-muted-foreground' : 'text-warning'}>
        {selected.length
          ? `MCP: ${selected.length} ${cli} server${selected.length === 1 ? '' : 's'} on`
          : `MCP tools are off — Elrond's MCP servers don't reach ${cli} agents`}
      </span>
      <button
        onClick={() => setOpen(true)}
        className="ml-auto shrink-0 text-primary underline decoration-primary/30 underline-offset-2"
      >
        Choose servers…
      </button>
      <CliMcpDialog provider={provider} open={open} onOpenChange={setOpen} selected={selected} onChange={save} />
    </div>
  )
}

function CliMcpDialog({
  provider,
  open,
  onOpenChange,
  selected,
  onChange
}: {
  provider: SubscriptionProvider
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const cli = CLI_NAMES[provider]
  const [servers, setServers] = useState<CliMcpServer[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setServers(await window.elrond.listCliMcpServers(provider, refresh).catch(() => []))
      setLoading(false)
    },
    [provider]
  )

  useEffect(() => {
    if (open && servers === null) load()
  }, [open, servers, load])

  const listed = servers ?? []
  const matches = (name: string): boolean => name.toLowerCase().includes(filter.trim().toLowerCase())
  const available = listed.filter((s) => !selected.includes(s.name) && matches(s.name))
  // Chosen servers stay listed even if the CLI no longer reports them, so they
  // can be removed
  const chosen = selected
    .filter(matches)
    .map((name) => listed.find((s) => s.name === name) ?? { name, status: servers ? 'not found' : '' })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cli} MCP servers</DialogTitle>
        </DialogHeader>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-warning">
            Selected servers&apos; tools run without asking — Elrond can&apos;t show approval prompts in a headless run.
            Leave anything that can change or delete things unselected.
          </p>
          {provider === 'anthropic' && (
            <p className="text-xs text-muted-foreground">
              With servers selected, each Claude call waits up to 15s for your MCP servers to start.
            </p>
          )}
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter servers"
            className="h-8 text-xs"
          />
          <div className="grid grid-cols-2 gap-3">
            <ServerColumn
              title="Available"
              count={available.length}
              loading={loading || servers === null}
              loadingText={
                provider === 'anthropic' ? 'Claude Code checks each server — this can take ~30s…' : 'Loading…'
              }
              empty={filter ? 'No matches' : listed.length ? 'All servers selected' : `No MCP servers in your ${cli} setup`}
              servers={available}
              icon={<ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
              onPick={(name) => onChange([...selected, name])}
            />
            <ServerColumn
              title="Selected"
              count={chosen.length}
              empty={filter ? 'No matches' : 'None — click a server on the left to allow it'}
              servers={chosen}
              icon={<X className="h-3 w-3 shrink-0 text-muted-foreground" />}
              onPick={(name) => onChange(selected.filter((n) => n !== name))}
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="text-xs text-primary underline decoration-primary/30 underline-offset-2 disabled:opacity-50"
            >
              Refresh list
            </button>
            <Button size="sm" className="h-8" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Claude's statuses can be long error messages ("✗ Failed to connect —
// ENOEXEC: …"); show a short label and keep the full text for the tooltip
function statusBadge(status: string): { label: string; dot: string; text: string } | null {
  if (!status) return null
  if (/fail|error|✗/i.test(status)) return { label: 'Failed', dot: 'bg-destructive', text: 'text-destructive' }
  if (/auth/i.test(status)) return { label: 'Needs auth', dot: 'bg-warning', text: 'text-warning' }
  if (/connected/i.test(status)) return { label: 'Connected', dot: 'bg-success', text: 'text-muted-foreground' }
  return { label: status, dot: 'bg-muted-foreground', text: 'text-muted-foreground' }
}

function ServerColumn({
  title,
  count,
  loading = false,
  loadingText,
  empty,
  servers,
  icon,
  onPick
}: {
  title: string
  count: number
  loading?: boolean
  loadingText?: string
  empty: string
  servers: CliMcpServer[]
  icon: React.ReactNode
  onPick: (name: string) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
        {title}
        <span className="font-normal text-muted-foreground">{count}</span>
      </div>
      <div className="h-72 overflow-y-auto overflow-x-hidden p-1">
        {loading ? (
          <div className="flex items-center gap-2 p-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            {loadingText}
          </div>
        ) : servers.length === 0 ? (
          <div className="p-2 text-[11px] text-muted-foreground">{empty}</div>
        ) : (
          servers.map((server) => {
            const badge = statusBadge(server.status)
            return (
              <button
                key={server.name}
                onClick={() => onPick(server.name)}
                title={server.status ? `${server.name} — ${server.status}` : server.name}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-muted"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${badge?.dot ?? 'bg-transparent'}`} />
                <span className="min-w-0 flex-1 truncate font-mono">{server.name}</span>
                {badge && <span className={`shrink-0 ${badge.text}`}>{badge.label}</span>}
                {icon}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
