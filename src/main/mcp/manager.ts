import { app, BrowserWindow } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  MCPConnectionStatus,
  MCPServerConfig,
  MCPServerInfo,
  MCPServerInput,
  MCPStatusEvent,
  MCPToolInfo
} from '../../shared/types'
import * as store from './store'
import { getShellPath } from './shellEnv'

// Generous: mcp-remote's first run downloads the package and then waits for a
// browser OAuth approval — a short timeout would kill and respawn it, popping
// a fresh browser tab on every retry
const CONNECT_TIMEOUT_MS = 120_000
const CALL_TIMEOUT_MS = 60_000
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000]
const STDERR_TAIL_CHARS = 2_048

interface ManagedServer {
  config: MCPServerConfig
  client: Client | null
  status: MCPConnectionStatus
  tools: MCPToolInfo[]
  lastError?: string
  connectPromise: Promise<void> | null
  retryTimer: NodeJS.Timeout | null
  retryCount: number
  // Bumped on every connect/disconnect; callbacks from superseded clients no-op
  generation: number
  stderrTail: string
  // Serializes tool calls per server — many stdio servers are effectively serial
  callQueue: Promise<unknown>
}

const servers = new Map<string, ManagedServer>()

function send(event: MCPStatusEvent): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send('mcp:statusChanged', event)
  }
}

function setStatus(server: ManagedServer, status: MCPConnectionStatus, error?: string): void {
  server.status = status
  server.lastError = error
  send({
    serverId: server.config.id,
    status,
    toolCount: server.tools.length,
    error
  })
}

function newManaged(config: MCPServerConfig): ManagedServer {
  return {
    config,
    client: null,
    status: 'disconnected',
    tools: [],
    connectPromise: null,
    retryTimer: null,
    retryCount: 0,
    generation: 0,
    stderrTail: '',
    callQueue: Promise.resolve()
  }
}

function clearRetry(server: ManagedServer): void {
  if (server.retryTimer) {
    clearTimeout(server.retryTimer)
    server.retryTimer = null
  }
}

function scheduleRetry(server: ManagedServer): void {
  if (server.retryCount >= RETRY_DELAYS_MS.length) return
  const delay = RETRY_DELAYS_MS[server.retryCount]
  server.retryCount += 1
  server.retryTimer = setTimeout(() => {
    server.retryTimer = null
    if (servers.get(server.config.id) === server && server.config.enabled) {
      void connect(server.config.id)
    }
  }, delay)
}

function describeError(server: ManagedServer, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/ENOENT/.test(raw) && server.config.transport.type === 'stdio') {
    return `${server.config.transport.command} not found — install Node.js (or fix your PATH)`
  }
  // Pull the most descriptive line out of stderr — crash dumps end in stack
  // frames and JSON fragments, so "last 3 lines" buries the actual error
  const lines = server.stderrTail.trim().split('\n')
  const errorLine = lines
    .filter((l) => /error/i.test(l) && !/^\s+at\s/.test(l) && !/^\s*["{}[\]]/.test(l.trim()))
    .pop()
  const detail = (errorLine ?? lines[lines.length - 1] ?? '').trim().slice(0, 300)
  return detail && !raw.includes(detail) ? `${raw} — ${detail}` : raw
}

async function buildTransport(server: ManagedServer): Promise<StdioClientTransport | StreamableHTTPClientTransport> {
  const resolved = await store.resolveTransport(server.config)
  if (resolved.type === 'http') {
    return new StreamableHTTPClientTransport(new URL(resolved.url), {
      requestInit: { headers: resolved.headers }
    })
  }

  const shellPath = await getShellPath()
  const transport = new StdioClientTransport({
    command: resolved.command,
    args: resolved.args,
    env: { ...getDefaultEnvironment(), PATH: shellPath, ...resolved.env },
    stderr: 'pipe'
  })
  server.stderrTail = ''
  transport.stderr?.on('data', (chunk: Buffer) => {
    server.stderrTail = (server.stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS)
  })
  return transport
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })
  ])
}

async function doConnect(server: ManagedServer): Promise<void> {
  const generation = ++server.generation
  clearRetry(server)
  setStatus(server, 'connecting')

  let client: Client | null = null
  try {
    const transport = await buildTransport(server)
    client = new Client({ name: 'elrond', version: app.getVersion() }, { capabilities: {} })
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'Connection timed out')

    if (generation !== server.generation) {
      void client.close().catch(() => {})
      return
    }

    const { tools } = await client.listTools()
    if (generation !== server.generation) {
      void client.close().catch(() => {})
      return
    }

    // Hook the client's callbacks, not the transport's — connect() installs
    // the SDK's own transport handlers and overwriting them breaks its cleanup
    client.onclose = () => {
      if (generation !== server.generation) return
      server.client = null
      setStatus(server, 'error', 'Connection closed unexpectedly')
      scheduleRetry(server)
    }
    client.onerror = (err) => {
      if (generation !== server.generation) return
      server.lastError = describeError(server, err)
    }

    server.client = client
    server.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>
    }))
    server.retryCount = 0
    setStatus(server, 'connected')
  } catch (err) {
    if (client) void client.close().catch(() => {})
    if (generation !== server.generation) return
    server.client = null
    setStatus(server, 'error', describeError(server, err))
    scheduleRetry(server)
  }
}

export function connect(id: string): Promise<void> {
  const server = servers.get(id)
  if (!server) return Promise.reject(new Error(`Unknown MCP server: ${id}`))
  if (server.status === 'connected') return Promise.resolve()
  if (!server.connectPromise) {
    server.connectPromise = doConnect(server).finally(() => {
      server.connectPromise = null
    })
  }
  return server.connectPromise
}

async function disconnect(server: ManagedServer): Promise<void> {
  server.generation += 1
  clearRetry(server)
  server.retryCount = 0
  const client = server.client
  server.client = null
  server.tools = []
  if (client) {
    await client.close().catch(() => {})
  }
  setStatus(server, 'disconnected')
}

// --- Config CRUD (persist via store, keep connections in sync) ---

export function initMcpManager(): void {
  for (const config of store.listServerConfigs()) {
    servers.set(config.id, newManaged(config))
    if (config.enabled) {
      void connect(config.id)
    }
  }
}

export function shutdownMcpManager(): void {
  for (const server of servers.values()) {
    server.generation += 1
    clearRetry(server)
    if (server.client) {
      void server.client.close().catch(() => {})
      server.client = null
    }
  }
}

export function getServerInfos(): MCPServerInfo[] {
  return [...servers.values()].map((s) => ({
    ...s.config,
    status: s.status,
    toolCount: s.tools.length,
    lastError: s.lastError
  }))
}

function getServerInfo(id: string): MCPServerInfo {
  const server = servers.get(id)
  if (!server) throw new Error(`Unknown MCP server: ${id}`)
  return {
    ...server.config,
    status: server.status,
    toolCount: server.tools.length,
    lastError: server.lastError
  }
}

export async function addServer(input: MCPServerInput): Promise<MCPServerInfo> {
  const config = await store.insertServer(input)
  servers.set(config.id, newManaged(config))
  if (config.enabled) {
    void connect(config.id)
  }
  return getServerInfo(config.id)
}

export async function updateServer(id: string, input: MCPServerInput): Promise<MCPServerInfo> {
  const server = servers.get(id)
  if (!server) throw new Error(`Unknown MCP server: ${id}`)
  await disconnect(server)
  server.config = await store.updateServer(id, input)
  if (server.config.enabled) {
    void connect(id)
  }
  return getServerInfo(id)
}

export async function deleteServer(id: string): Promise<void> {
  const server = servers.get(id)
  if (!server) return
  await disconnect(server)
  servers.delete(id)
  await store.deleteServer(id)
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const server = servers.get(id)
  if (!server) throw new Error(`Unknown MCP server: ${id}`)
  store.setServerEnabled(id, enabled)
  server.config.enabled = enabled
  if (enabled) {
    void connect(id)
  } else {
    await disconnect(server)
  }
}

export async function reconnect(id: string): Promise<void> {
  const server = servers.get(id)
  if (!server) throw new Error(`Unknown MCP server: ${id}`)
  await disconnect(server)
  if (server.config.enabled) {
    void connect(id)
  }
}

export function listServerTools(id: string): MCPToolInfo[] {
  return servers.get(id)?.tools ?? []
}

// --- API for the deliberation tool loop ---

export async function listAllTools(): Promise<
  { serverId: string; serverName: string; tool: MCPToolInfo }[]
> {
  const results: { serverId: string; serverName: string; tool: MCPToolInfo }[] = []
  for (const server of servers.values()) {
    if (!server.config.enabled) continue
    if (server.connectPromise) {
      // Give an in-flight connect a moment, but don't stall the deliberation
      await withTimeout(server.connectPromise, 5_000, 'connect pending').catch(() => {})
    }
    if (server.status !== 'connected') continue
    for (const tool of server.tools) {
      results.push({ serverId: server.config.id, serverName: server.config.name, tool })
    }
  }
  return results
}

export async function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<CallToolResult> {
  const server = servers.get(serverId)
  if (!server || !server.config.enabled) {
    throw new Error(`MCP server not available: ${serverId}`)
  }
  if (server.status !== 'connected') {
    await connect(serverId)
  }

  const run = async (): Promise<CallToolResult> => {
    const client = server.client
    if (!client) {
      throw new Error(`MCP server "${server.config.name}" is not connected: ${server.lastError ?? 'unknown error'}`)
    }
    return (await client.callTool({ name: toolName, arguments: args }, undefined, {
      timeout: CALL_TIMEOUT_MS,
      signal
    })) as CallToolResult
  }

  // Chain onto the per-server queue; a failed call must not poison the chain
  const result = server.callQueue.then(run)
  server.callQueue = result.catch(() => {})
  return result
}
