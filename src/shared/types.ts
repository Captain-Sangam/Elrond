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
  agent_name: string | null
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

export type ProviderName = 'openai' | 'anthropic' | 'google'

// Keychain identifiers: the three LLM providers plus the Brave Search key
export type KeyProvider = ProviderName | 'brave'

export interface ProviderConfig {
  name: ProviderName
  label: string
  model: string
  enabled: boolean
}

export interface AgentResponse {
  provider: ProviderName
  content: string
  tokenCount: number
}

export type StreamPhase = 'initial' | 'debate' | 'synthesis'

// Emitted when a provider call begins, with the estimated prompt size —
// lets the UI show input tokens before any output streams back
export interface StreamStart {
  provider: ProviderName
  phase: StreamPhase
  round?: number
  inputTokens: number
}

export interface StreamToken {
  provider: ProviderName
  delta: string
  phase: StreamPhase
  round?: number
}

export interface StreamDone {
  provider: ProviderName
  fullContent: string
  tokenCount: number
  phase: StreamPhase
  round?: number
}

export interface StreamError {
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

export interface DeliberationRequest {
  sessionId: string
  prompt: string
  providers: ProviderConfig[]
  enableDebate: boolean
  maxDebateRounds: number
  synthesizer: ProviderName
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

  // Models
  listModels: (provider: ProviderName, apiKey: string) => Promise<string[]>

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
}

declare global {
  interface Window {
    elrond: ElrondAPI
  }
}
