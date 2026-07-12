import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import { getApiKey, setApiKey, deleteApiKey, findCredentialAccounts } from '../keychain'
import {
  MCP_SECRET_SENTINEL,
  type MCPServerConfig,
  type MCPServerInput,
  type MCPTransport
} from '../../shared/types'

interface MCPServerRow {
  id: string
  name: string
  transport: string
  enabled: number
  source: string
  created_at: string
}

function rowToConfig(row: MCPServerRow): MCPServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: JSON.parse(row.transport) as MCPTransport,
    enabled: row.enabled === 1,
    source: row.source as MCPServerConfig['source'],
    created_at: row.created_at
  }
}

function secretAccount(serverId: string, field: string): string {
  return `mcp:${serverId}:${field}`
}

// Env/header slots holding the Keychain sentinel — the fields whose real
// values must exist as `mcp:<id>:<field>` Keychain entries
function sentinelFields(transport: MCPTransport): string[] {
  const record = transport.type === 'stdio' ? transport.env : transport.headers
  return Object.keys(record).filter((k) => record[k] === MCP_SECRET_SENTINEL)
}

async function saveSecrets(serverId: string, secrets: Record<string, string> | undefined): Promise<void> {
  if (!secrets) return
  for (const [field, value] of Object.entries(secrets)) {
    // A sentinel value means "keep the existing Keychain entry" on edit
    if (value && value !== MCP_SECRET_SENTINEL) {
      await setApiKey(secretAccount(serverId, field), value)
    }
  }
}

export function listServerConfigs(): MCPServerConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM mcp_servers ORDER BY created_at')
    .all() as MCPServerRow[]
  return rows.map(rowToConfig)
}

export function getServerConfig(id: string): MCPServerConfig | null {
  const row = getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as
    | MCPServerRow
    | undefined
  return row ? rowToConfig(row) : null
}

export async function insertServer(input: MCPServerInput): Promise<MCPServerConfig> {
  const id = uuidv4()
  await saveSecrets(id, input.secrets)
  getDb()
    .prepare('INSERT INTO mcp_servers (id, name, transport, enabled, source) VALUES (?, ?, ?, ?, ?)')
    .run(id, input.name, JSON.stringify(input.transport), input.enabled ? 1 : 0, input.source)
  const config = getServerConfig(id)
  if (!config) throw new Error('Failed to insert MCP server')
  return config
}

export async function updateServer(id: string, input: MCPServerInput): Promise<MCPServerConfig> {
  const existing = getServerConfig(id)
  if (!existing) throw new Error(`Unknown MCP server: ${id}`)

  await saveSecrets(id, input.secrets)

  // Prune Keychain entries for fields the new transport no longer marks secret
  const stale = sentinelFields(existing.transport).filter(
    (f) => !sentinelFields(input.transport).includes(f)
  )
  for (const field of stale) {
    await deleteApiKey(secretAccount(id, field))
  }

  getDb()
    .prepare('UPDATE mcp_servers SET name = ?, transport = ?, enabled = ?, source = ? WHERE id = ?')
    .run(input.name, JSON.stringify(input.transport), input.enabled ? 1 : 0, input.source, id)
  const config = getServerConfig(id)
  if (!config) throw new Error(`Unknown MCP server: ${id}`)
  return config
}

export async function deleteServer(id: string): Promise<void> {
  getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  const prefix = `mcp:${id}:`
  const accounts = await findCredentialAccounts()
  for (const account of accounts) {
    if (account.startsWith(prefix)) {
      await deleteApiKey(account)
    }
  }
}

export function setServerEnabled(id: string, enabled: boolean): void {
  getDb().prepare('UPDATE mcp_servers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

// Deep-copies the transport with every Keychain sentinel replaced by its
// real value. Never persist or send the result anywhere.
export async function resolveTransport(config: MCPServerConfig): Promise<MCPTransport> {
  const transport = JSON.parse(JSON.stringify(config.transport)) as MCPTransport
  const record = transport.type === 'stdio' ? transport.env : transport.headers
  for (const field of Object.keys(record)) {
    if (record[field] !== MCP_SECRET_SENTINEL) continue
    const value = await getApiKey(secretAccount(config.id, field))
    if (!value) {
      throw new Error(`Missing Keychain secret for "${field}" — re-enter it in Settings`)
    }
    record[field] = value
  }
  return transport
}
