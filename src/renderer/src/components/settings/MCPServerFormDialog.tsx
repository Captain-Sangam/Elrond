import React, { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@renderer/components/ui/select'
import { useMcpStore } from '@renderer/stores/mcpStore'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { MCP_SECRET_SENTINEL, type MCPServerInfo, type MCPTransport } from '@shared/types'

interface MCPServerFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Edit mode when set; otherwise creates a custom server
  server?: MCPServerInfo | null
}

// One env var (stdio) or header (http). `hasStored` marks fields whose value
// already lives in the Keychain — leaving the value blank keeps it.
interface KeyValueRow {
  field: string
  value: string
  secret: boolean
  hasStored: boolean
}

function rowsFromRecord(record: Record<string, string>): KeyValueRow[] {
  return Object.entries(record).map(([field, value]) => {
    const secret = value === MCP_SECRET_SENTINEL
    return { field, value: secret ? '' : value, secret, hasStored: secret }
  })
}

export function MCPServerFormDialog({
  open,
  onOpenChange,
  server
}: MCPServerFormDialogProps): React.JSX.Element {
  const { addServer, updateServer } = useMcpStore()

  const [name, setName] = useState('')
  const [transportType, setTransportType] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [url, setUrl] = useState('')
  const [rows, setRows] = useState<KeyValueRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (server) {
      setName(server.name)
      setTransportType(server.transport.type)
      if (server.transport.type === 'stdio') {
        setCommand(server.transport.command)
        setArgsText(server.transport.args.join(' '))
        setUrl('')
        setRows(rowsFromRecord(server.transport.env))
      } else {
        setUrl(server.transport.url)
        setCommand('')
        setArgsText('')
        setRows(rowsFromRecord(server.transport.headers))
      }
    } else {
      setName('')
      setTransportType('stdio')
      setCommand('')
      setArgsText('')
      setUrl('')
      setRows([])
    }
  }, [open, server])

  const updateRow = (index: number, patch: Partial<KeyValueRow>): void => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const handleSave = async (): Promise<void> => {
    const trimmedName = name.trim()
    if (!trimmedName) return setError('Name is required')
    if (transportType === 'stdio' && !command.trim()) return setError('Command is required')
    if (transportType === 'http') {
      try {
        new URL(url)
      } catch {
        return setError('A valid URL is required')
      }
    }

    const record: Record<string, string> = {}
    const secrets: Record<string, string> = {}
    for (const row of rows) {
      const field = row.field.trim()
      if (!field) continue
      if (row.secret) {
        record[field] = MCP_SECRET_SENTINEL
        if (row.value.trim()) {
          secrets[field] = row.value.trim()
        } else if (!row.hasStored) {
          return setError(`Enter a value for secret "${field}"`)
        }
      } else {
        record[field] = row.value
      }
    }

    const transport: MCPTransport =
      transportType === 'stdio'
        ? {
            type: 'stdio',
            command: command.trim(),
            args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
            env: record
          }
        : { type: 'http', url: url.trim(), headers: record }

    setSaving(true)
    setError('')
    try {
      const input = {
        name: trimmedName,
        transport,
        enabled: server ? server.enabled : true,
        source: server ? server.source : ('custom' as const),
        secrets: Object.keys(secrets).length ? secrets : undefined
      }
      if (server) {
        await updateServer(server.id, input)
      } else {
        await addServer(input)
      }
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server')
    } finally {
      setSaving(false)
    }
  }

  const rowLabel = transportType === 'stdio' ? 'Environment variables' : 'Headers'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{server ? `Edit ${server.name}` : 'Add MCP Server'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP server"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Transport</label>
            <Select
              value={transportType}
              onValueChange={(v) => {
                setTransportType(v as 'stdio' | 'http')
                setRows([])
              }}
            >
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">Local command (stdio)</SelectItem>
                <SelectItem value="http">Remote server (HTTP)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {transportType === 'stdio' ? (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Command</label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Arguments</label>
                <Input
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder="-y my-mcp-server --flag"
                  className="h-8 font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">Space-separated.</p>
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">URL</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="h-8 font-mono text-xs"
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">{rowLabel}</label>
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 text-[10px]"
                onClick={() =>
                  setRows((prev) => [...prev, { field: '', value: '', secret: false, hasStored: false }])
                }
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={row.field}
                  onChange={(e) => updateRow(i, { field: e.target.value })}
                  placeholder={transportType === 'stdio' ? 'API_KEY' : 'Authorization'}
                  className="h-7 flex-1 font-mono text-xs"
                />
                <Input
                  type={row.secret ? 'password' : 'text'}
                  value={row.value}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                  placeholder={row.hasStored ? '•••••••• (stored — leave blank to keep)' : 'value'}
                  className="h-7 flex-[2] font-mono text-xs"
                />
                <label
                  className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-muted-foreground"
                  title="Store the value in the macOS Keychain instead of the database"
                >
                  <input
                    type="checkbox"
                    checked={row.secret}
                    onChange={(e) => updateRow(i, { secret: e.target.checked })}
                    className="h-3 w-3"
                  />
                  Secret
                </label>
                <button
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded p-1 hover:bg-accent"
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </div>

          {error && <p className="text-[10px] text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" className="gap-1" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              {server ? 'Save' : 'Add Server'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
