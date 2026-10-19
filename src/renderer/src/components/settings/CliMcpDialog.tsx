import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { ChevronRight, Loader2, RefreshCw, X } from 'lucide-react'
import type { CliMcpServer, SubscriptionProvider } from '@shared/types'

// Opt-in to MCP servers from the user's own CLI setup: a status line here,
// the two-column chooser in its own dialog. Headless runs can't show approval
// prompts, so a chosen server's tools run without asking — hence nothing is
// chosen by default.
export function CliMcpPicker({ provider, cli }: { provider: SubscriptionProvider; cli: string }): React.JSX.Element {
  const settingKey = `${provider}_cli_mcp`
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
    const previous = selected
    setSelected(next)
    // Don't show a selection that didn't persist — runs read the saved one
    window.elrond.setSetting(settingKey, JSON.stringify(next)).catch(() => setSelected(previous))
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
      <CliMcpDialog provider={provider} cli={cli} open={open} onOpenChange={setOpen} selected={selected} onChange={save} />
    </div>
  )
}

function CliMcpDialog({
  provider,
  cli,
  open,
  onOpenChange,
  selected,
  onChange
}: {
  provider: SubscriptionProvider
  cli: string
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const [servers, setServers] = useState<CliMcpServer[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [checking, setChecking] = useState<string[]>([])

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

  const check = useCallback(
    async (name: string) => {
      setChecking((prev) => [...prev, name])
      const server = await window.elrond.checkCliMcpServer(provider, name).catch(() => null)
      if (server) setServers((prev) => prev?.map((s) => (s.name === name ? server : s)) ?? prev)
      setChecking((prev) => prev.filter((n) => n !== name))
    },
    [provider]
  )
  const needsAuth = (servers ?? []).some((s) => statusBadge(s.status)?.label === 'Needs auth')

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
              onCheck={check}
              checking={checking}
            />
            <ServerColumn
              title="Selected"
              count={chosen.length}
              empty={filter ? 'No matches' : 'None — click a server on the left to allow it'}
              servers={chosen}
              icon={<X className="h-3 w-3 shrink-0 text-muted-foreground" />}
              onPick={(name) => onChange(selected.filter((n) => n !== name))}
              onCheck={check}
              checking={checking}
            />
          </div>
          {needsAuth && (
            <p className="text-[11px] text-muted-foreground">
              Servers marked Needs auth sign in through the CLI —{' '}
              {provider === 'anthropic' ? (
                <>
                  run <span className="font-mono">claude</span> in a terminal and use{' '}
                  <span className="font-mono">/mcp</span>
                </>
              ) : (
                <>
                  run <span className="font-mono">codex mcp login &lt;name&gt;</span>
                </>
              )}
              , then re-check them here.
            </p>
          )}
          <div className="flex items-center justify-between">
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="text-xs text-primary underline decoration-primary/30 underline-offset-2 disabled:opacity-50"
            >
              Re-check all
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
  onPick,
  onCheck,
  checking
}: {
  title: string
  count: number
  loading?: boolean
  loadingText?: string
  empty: string
  servers: CliMcpServer[]
  icon: React.ReactNode
  onPick: (name: string) => void
  onCheck: (name: string) => void
  checking: string[]
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
            const isChecking = checking.includes(server.name)
            return (
              <div key={server.name} className="flex items-center rounded hover:bg-muted">
                <button
                  onClick={() => onPick(server.name)}
                  title={server.status ? `${server.name} — ${server.status}` : server.name}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 pr-2 text-left text-[11px]"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${badge?.dot ?? 'bg-transparent'}`} />
                  <span className="min-w-0 flex-1 truncate font-mono">{server.name}</span>
                  {badge && <span className={`shrink-0 ${badge.text}`}>{isChecking ? 'Checking…' : badge.label}</span>}
                  {icon}
                </button>
                {/* Only servers that aren't connected need a re-check */}
                {badge && badge.label !== 'Connected' && (
                  <button
                    onClick={() => onCheck(server.name)}
                    disabled={isChecking}
                    title="Re-check this server"
                    className="shrink-0 py-1.5 pr-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
