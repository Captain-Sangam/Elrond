import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Badge } from '@renderer/components/ui/badge'
import { useMcpStore } from '@renderer/stores/mcpStore'
import { MCP_PRESETS, type MCPPreset } from '@shared/mcpPresets'
import type { MCPServerInfo, MCPToolInfo } from '@shared/types'
import {
  BookOpen,
  Bug,
  FileText,
  FolderOpen,
  GitBranch,
  KeyRound,
  ListChecks,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  Wrench
} from 'lucide-react'
import { MCPServerFormDialog } from './MCPServerFormDialog'

const PRESET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  linear: ListChecks,
  notion: FileText,
  github: GitBranch,
  sentry: Bug,
  context7: BookOpen,
  filesystem: FolderOpen
}

function serverIcon(source: string): React.ComponentType<{ className?: string }> {
  return PRESET_ICONS[source] ?? Plug
}

function transportSummary(server: MCPServerInfo): string {
  return server.transport.type === 'stdio'
    ? `${server.transport.command} ${server.transport.args.join(' ')}`
    : server.transport.url
}

function StatusBadge({ server }: { server: MCPServerInfo }): React.JSX.Element {
  if (!server.enabled) {
    return (
      <Badge variant="outline" className="text-[9px] text-muted-foreground">
        Disabled
      </Badge>
    )
  }
  switch (server.status) {
    case 'connected':
      return (
        <Badge className="border-green-500/30 bg-green-500/10 text-[9px] text-green-400">
          Connected
        </Badge>
      )
    case 'connecting':
      return (
        <Badge variant="outline" className="gap-1 text-[9px] text-muted-foreground">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Connecting
        </Badge>
      )
    case 'error':
      return (
        <Badge
          className="border-red-500/30 bg-red-500/10 text-[9px] text-red-400"
          title={server.lastError}
        >
          Error
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="text-[9px] text-muted-foreground">
          Off
        </Badge>
      )
  }
}

interface MCPManagerProps {
  active: boolean
}

export function MCPManager({ active }: MCPManagerProps): React.JSX.Element {
  const { servers, loaded, loadServers, addServer, deleteServer, setEnabled, reconnect } =
    useMcpStore()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedTools, setExpandedTools] = useState<MCPToolInfo[]>([])
  const [secretPresetId, setSecretPresetId] = useState<string | null>(null)
  const [secretValue, setSecretValue] = useState('')
  const [addingPresetId, setAddingPresetId] = useState<string | null>(null)
  const [hasGithubToken, setHasGithubToken] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editServer, setEditServer] = useState<MCPServerInfo | null>(null)

  useEffect(() => {
    if (!active) return
    if (!loaded) loadServers()
    window.elrond.getGitHubToken().then((token) => setHasGithubToken(!!token))
  }, [active, loaded, loadServers])

  const handleToggleTools = useCallback(
    async (server: MCPServerInfo) => {
      if (expandedId === server.id) {
        setExpandedId(null)
        return
      }
      const tools = await window.elrond.listMcpTools(server.id)
      setExpandedTools(tools)
      setExpandedId(server.id)
    },
    [expandedId]
  )

  const handleDelete = useCallback(
    async (server: MCPServerInfo) => {
      if (confirm(`Remove "${server.name}"? Its stored secrets are deleted from the Keychain.`)) {
        if (expandedId === server.id) setExpandedId(null)
        await deleteServer(server.id)
      }
    },
    [deleteServer, expandedId]
  )

  const addPreset = useCallback(
    async (preset: MCPPreset, secrets?: Record<string, string>) => {
      setAddingPresetId(preset.id)
      try {
        let transport = preset.transport
        if (preset.needsDirectoryPicker && transport.type === 'stdio') {
          const dirs = await window.elrond.pickMcpDirectories()
          if (!dirs || dirs.length === 0) return
          transport = { ...transport, args: [...transport.args, ...dirs] }
        }
        await addServer({
          name: preset.label,
          transport,
          enabled: true,
          source: preset.id,
          secrets
        })
        setSecretPresetId(null)
        setSecretValue('')
      } finally {
        setAddingPresetId(null)
      }
    },
    [addServer]
  )

  const handlePresetAddClick = useCallback(
    (preset: MCPPreset) => {
      if (preset.secretFields.length > 0) {
        setSecretPresetId((prev) => (prev === preset.id ? null : preset.id))
        setSecretValue('')
        return
      }
      void addPreset(preset)
    },
    [addPreset]
  )

  const handlePresetSecretSubmit = useCallback(
    (preset: MCPPreset, rawValue: string) => {
      const field = preset.secretFields[0]
      const value = field.valueTemplate
        ? field.valueTemplate.replace('{value}', rawValue.trim())
        : rawValue.trim()
      void addPreset(preset, { [field.field]: value })
    },
    [addPreset]
  )

  const handleUseSavedGithubToken = useCallback(
    async (preset: MCPPreset) => {
      const token = await window.elrond.getGitHubToken()
      if (token) handlePresetSecretSubmit(preset, token)
    },
    [handlePresetSecretSubmit]
  )

  const availablePresets = MCP_PRESETS.filter((p) => !servers.some((s) => s.source === p.id))

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">MCP Servers</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Connect Model Context Protocol servers to give the agents tools — they can call them
          mid-deliberation to fetch live data from Linear, Notion, GitHub, your filesystem, and
          more.
        </p>
      </section>

      {/* Configured servers */}
      {servers.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium">Configured</h4>
          <div className="space-y-0.5 rounded-md border p-1">
            {servers.map((server) => {
              const Icon = serverIcon(server.source)
              return (
                <div key={server.id}>
                  <div className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent/50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-xs font-medium">{server.name}</span>
                        <StatusBadge server={server} />
                        {server.enabled && server.status === 'connected' && (
                          <button onClick={() => handleToggleTools(server)}>
                            <Badge
                              variant="outline"
                              className="cursor-pointer gap-1 text-[9px] hover:bg-accent"
                            >
                              <Wrench className="h-2.5 w-2.5" />
                              {server.toolCount} tools
                            </Badge>
                          </button>
                        )}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {transportSummary(server)}
                      </div>
                      {server.status === 'error' && server.lastError && (
                        <div className="text-[10px] text-destructive">{server.lastError}</div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant={server.enabled ? 'default' : 'outline'}
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => setEnabled(server.id, !server.enabled)}
                      >
                        {server.enabled ? 'On' : 'Off'}
                      </Button>
                      <button
                        onClick={() => reconnect(server.id)}
                        className="rounded p-1 hover:bg-background"
                        title="Reconnect"
                      >
                        <RefreshCw className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => {
                          setEditServer(server)
                          setFormOpen(true)
                        }}
                        className="rounded p-1 hover:bg-background"
                        title="Edit"
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(server)}
                        className="rounded p-1 hover:bg-background"
                        title="Remove server and its secrets"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  </div>

                  {expandedId === server.id && (
                    <div className="mx-2.5 mb-1.5 flex flex-wrap gap-1 rounded-md bg-accent/30 p-2">
                      {expandedTools.map((tool) => (
                        <Badge
                          key={tool.name}
                          variant="outline"
                          className="text-[9px]"
                          title={tool.description}
                        >
                          {tool.name}
                        </Badge>
                      ))}
                      {expandedTools.length === 0 && (
                        <span className="text-[10px] text-muted-foreground">No tools reported</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Preset gallery */}
      {availablePresets.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium">Available</h4>
          <div className="grid grid-cols-2 gap-2">
            {availablePresets.map((preset) => {
              const Icon = serverIcon(preset.id)
              const adding = addingPresetId === preset.id
              const secretOpen = secretPresetId === preset.id
              return (
                <div key={preset.id} className="space-y-2 rounded-md border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs font-medium">{preset.label}</span>
                      </div>
                      <p className="pt-0.5 text-[10px] text-muted-foreground">
                        {preset.description}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 shrink-0 gap-1 text-[10px]"
                      onClick={() => handlePresetAddClick(preset)}
                      disabled={adding}
                    >
                      {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      Add
                    </Button>
                  </div>
                  {preset.oauthNote && (
                    <p className="text-[10px] text-muted-foreground/70">{preset.oauthNote}</p>
                  )}
                  {secretOpen && preset.secretFields[0] && (
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">
                        {preset.secretFields[0].label}
                      </label>
                      <div className="flex gap-1.5">
                        <Input
                          type="password"
                          value={secretValue}
                          onChange={(e) => setSecretValue(e.target.value)}
                          placeholder={preset.secretFields[0].placeholder}
                          className="h-7 text-xs"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-[10px]"
                          onClick={() => handlePresetSecretSubmit(preset, secretValue)}
                          disabled={!secretValue.trim() || adding}
                        >
                          <KeyRound className="h-3 w-3" />
                          Connect
                        </Button>
                      </div>
                      {preset.id === 'github' && hasGithubToken && (
                        <button
                          onClick={() => handleUseSavedGithubToken(preset)}
                          className="text-[10px] text-primary underline decoration-primary/30 underline-offset-2"
                        >
                          Use the token saved in the GitHub tab
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Custom server */}
      <section>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            setEditServer(null)
            setFormOpen(true)
          }}
        >
          <Plus className="h-3 w-3" />
          Add custom server
        </Button>
      </section>

      <MCPServerFormDialog open={formOpen} onOpenChange={setFormOpen} server={editServer} />
    </div>
  )
}
