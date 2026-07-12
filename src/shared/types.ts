export interface Session {
  id: string
  title: string
  starred: boolean
  repo_id: string | null
  created_at: string
  updated_at: string
}

export interface GitHubRepo {
  id: number
  full_name: string
  name: string
  owner: string
  description: string | null
  language: string | null
  stargazers_count: number
  default_branch: string
  private: boolean
}

export interface IndexedRepo {
  id: string
  github_id: number
  full_name: string
  local_path: string
  indexed_at: string
  file_count: number
}

export type MessageRole = 'user' | 'agent' | 'debate' | 'moderator' | 'synthesis'

export interface Message {
  id: string
  session_id: string
  role: MessageRole
  // Agent display name. Rows written before agents were decoupled from
  // providers hold a provider name here instead.
  agent_name: string | null
  agent_id: string | null
  provider: ProviderName | null
  content: string
  token_count: number | null
  round: number
  created_at: string
  attachments?: Attachment[]
}

export interface Attachment {
  id: string
  message_id: string
  file_name: string
  mime_type: string
  size: number
  path: string
  created_at: string
}

// Wire format for attachments sent from renderer to main (base64, no data: prefix)
export interface AttachmentPayload {
  fileName: string
  mimeType: string
  data: string
}

export interface Setting {
  key: string
  value: string
}

export type ProviderName = 'openai' | 'anthropic' | 'google' | 'ollama'

// Keychain identifiers: the cloud LLM providers plus the Tavily web-search
// key. Ollama is deliberately absent — it's local and keyless.
export type KeyProvider = 'openai' | 'anthropic' | 'google' | 'tavily'

// A named deliberation slot. Agents are decoupled from providers: several
// agents may share a provider (e.g. two different Ollama models debating).
export interface AgentConfig {
  id: string
  name: string
  provider: ProviderName
  model: string
  enabled: boolean
}

export type StreamPhase = 'initial' | 'debate' | 'synthesis'

// Emitted when a provider call begins, with the estimated prompt size —
// lets the UI show input tokens before any output streams back.
// `provider` is kept on stream events for coloring only; identity is agentId.
export interface StreamStart {
  agentId: string
  agentName: string
  provider: ProviderName
  phase: StreamPhase
  round?: number
  inputTokens: number
}

export interface StreamToken {
  agentId: string
  agentName: string
  provider: ProviderName
  delta: string
  phase: StreamPhase
  round?: number
}

export interface StreamDone {
  agentId: string
  agentName: string
  provider: ProviderName
  fullContent: string
  tokenCount: number
  phase: StreamPhase
  round?: number
}

export interface StreamError {
  agentId: string
  agentName: string
  provider: ProviderName
  message: string
  phase?: StreamPhase
  round?: number
}

export interface PhaseChange {
  phase: 'fetching_context' | 'searching_web' | 'initial' | 'debate' | 'moderating' | 'synthesis' | 'complete'
  round?: number
  maxRounds?: number
}

// Non-fatal notices surfaced during a deliberation (channel 'stream:notice')
export interface DeliberationNotice {
  message: string
}

// Lifecycle of one MCP tool call inside an agent's stream (channel 'stream:tool').
// Upserted by callId: 'running' first, then 'ok' or 'error'.
export interface StreamToolEvent {
  agentId: string
  agentName: string
  provider: ProviderName
  phase: StreamPhase
  round?: number
  callId: string
  toolName: string
  serverName: string
  status: 'running' | 'ok' | 'error'
  argsPreview?: string
  resultPreview?: string
  errorMessage?: string
  durationMs?: number
}

// Progress of a repo indexing run (channel 'github:indexProgress').
// Keyed by the GitHub numeric id — the IndexedRepo uuid doesn't exist yet
// during the 'cloning' stage.
export interface IndexProgressEvent {
  repoId: number
  fullName: string
  stage: 'cloning' | 'scanning' | 'storing' | 'done' | 'error'
  fileCount?: number
  message?: string
}

// Emitted after the moderator reviews a debate round (channel 'stream:moderator')
export interface ModeratorVerdictEvent {
  round: number
  maxRounds: number
  converged: boolean
  disagreements: string[]
  summary: string
  continuing: boolean
  inputTokens: number
  outputTokens: number
}

// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) servers

export type MCPPresetId = 'linear' | 'notion' | 'github' | 'sentry' | 'context7' | 'filesystem'

// Placeholder stored in env/header slots whose real value lives in the macOS
// Keychain under account `mcp:<serverId>:<fieldName>`. Configs holding this
// sentinel are safe to persist in SQLite and send to the renderer.
export const MCP_SECRET_SENTINEL = '__KEYCHAIN__'

export type MCPTransport =
  | { type: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { type: 'http'; url: string; headers: Record<string, string> }

export interface MCPServerConfig {
  id: string
  name: string
  transport: MCPTransport
  enabled: boolean
  source: MCPPresetId | 'custom'
  created_at: string
}

export type MCPConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Config plus runtime connection state — what the renderer renders
export interface MCPServerInfo extends MCPServerConfig {
  status: MCPConnectionStatus
  toolCount: number
  lastError?: string
}

export interface MCPToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

// Pushed on channel 'mcp:statusChanged'
export interface MCPStatusEvent {
  serverId: string
  status: MCPConnectionStatus
  toolCount?: number
  error?: string
}

// Renderer -> main create/update payload. Secret values ride in `secrets`
// (keyed by env var / header name) and never come back; the transport carries
// MCP_SECRET_SENTINEL in those slots.
export interface MCPServerInput {
  name: string
  transport: MCPTransport
  enabled: boolean
  source: MCPPresetId | 'custom'
  secrets?: Record<string, string>
}

export interface DeliberationRequest {
  sessionId: string
  prompt: string
  agents: AgentConfig[]
  enableDebate: boolean
  maxDebateRounds: number
  synthesizerAgentId: string
  systemPrompt?: string
  repoId?: string
  repoFullName?: string
  attachments?: AttachmentPayload[]
  webSearch?: boolean
}

export interface ElrondAPI {
  // Keychain
  getApiKey: (provider: KeyProvider) => Promise<string | null>
  setApiKey: (provider: KeyProvider, key: string) => Promise<void>
  deleteApiKey: (provider: KeyProvider) => Promise<void>
  testApiKey: (provider: ProviderName, key: string) => Promise<boolean>
  testWebSearchKey: (key: string) => Promise<boolean>
  testOllamaConnection: (baseUrl: string) => Promise<boolean>

  // Agents
  getAgents: () => Promise<AgentConfig[]>
  saveAgents: (agents: AgentConfig[]) => Promise<void>

  // Sessions
  getSessions: () => Promise<Session[]>
  getSession: (id: string) => Promise<Session | null>
  createSession: (title?: string) => Promise<Session>
  updateSession: (id: string, updates: Partial<Pick<Session, 'title' | 'starred'>>) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  searchSessions: (query: string) => Promise<Session[]>

  // Messages
  getMessages: (sessionId: string) => Promise<Message[]>
  addMessage: (message: Omit<Message, 'id' | 'created_at'>) => Promise<Message>

  // Settings
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
  getAllSettings: () => Promise<Record<string, string>>

  // Deliberation
  startDeliberation: (request: DeliberationRequest) => Promise<void>
  cancelDeliberation: () => Promise<void>

  // Events
  onStreamStart: (callback: (start: StreamStart) => void) => () => void
  onStreamToken: (callback: (token: StreamToken) => void) => () => void
  onStreamDone: (callback: (done: StreamDone) => void) => () => void
  onStreamError: (callback: (error: StreamError) => void) => () => void
  onPhaseChange: (callback: (phase: PhaseChange) => void) => () => void
  onModeratorVerdict: (callback: (verdict: ModeratorVerdictEvent) => void) => () => void
  onNotice: (callback: (notice: DeliberationNotice) => void) => () => void
  onIndexProgress: (callback: (progress: IndexProgressEvent) => void) => () => void

  // Models — credential is the API key for cloud providers, or an optional
  // base-URL override for ollama (defaults to the stored ollama_base_url)
  listModels: (provider: ProviderName, credential?: string) => Promise<string[]>

  // Export
  exportSession: (sessionId: string, format: 'markdown' | 'json') => Promise<string>

  // GitHub
  getGitHubToken: () => Promise<string | null>
  setGitHubToken: (token: string) => Promise<void>
  deleteGitHubToken: () => Promise<void>
  testGitHubToken: (token: string) => Promise<boolean>
  listGitHubRepos: () => Promise<GitHubRepo[]>
  getIndexedRepos: () => Promise<IndexedRepo[]>
  indexRepo: (repo: GitHubRepo) => Promise<IndexedRepo>
  deleteIndexedRepo: (repoId: string) => Promise<void>
  searchRepoCode: (repoId: string, query: string) => Promise<{ path: string; content: string; score: number }[]>
  createRepoSession: (repoId: string, title?: string) => Promise<Session>

  // Window
  setGlobalShortcut: (shortcut: string) => Promise<boolean>
  getGlobalShortcut: () => Promise<string>

  // MCP servers
  listMcpServers: () => Promise<MCPServerInfo[]>
  addMcpServer: (input: MCPServerInput) => Promise<MCPServerInfo>
  updateMcpServer: (id: string, input: MCPServerInput) => Promise<MCPServerInfo>
  deleteMcpServer: (id: string) => Promise<void>
  setMcpServerEnabled: (id: string, enabled: boolean) => Promise<void>
  reconnectMcpServer: (id: string) => Promise<void>
  listMcpTools: (serverId: string) => Promise<MCPToolInfo[]>
  pickMcpDirectories: () => Promise<string[] | null>
  onMcpStatusChanged: (callback: (event: MCPStatusEvent) => void) => () => void
  onStreamTool: (callback: (event: StreamToolEvent) => void) => () => void
}

declare global {
  interface Window {
    elrond: ElrondAPI
  }
}
