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

export type MessageRole = 'user' | 'agent' | 'debate' | 'synthesis'

export interface Message {
  id: string
  session_id: string
  role: MessageRole
  agent_name: string | null
  content: string
  token_count: number | null
  created_at: string
}

export interface Setting {
  key: string
  value: string
}

export type ProviderName = 'openai' | 'anthropic' | 'google'

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

export interface StreamToken {
  provider: ProviderName
  delta: string
  phase: 'initial' | 'debate' | 'synthesis'
}

export interface StreamDone {
  provider: ProviderName
  fullContent: string
  tokenCount: number
  phase: 'initial' | 'debate' | 'synthesis'
}

export interface DeliberationRequest {
  sessionId: string
  prompt: string
  providers: ProviderConfig[]
  enableDebate: boolean
  synthesizer: ProviderName
  systemPrompt?: string
  repoId?: string
  repoFullName?: string
}

export interface ElrondAPI {
  // Keychain
  getApiKey: (provider: ProviderName) => Promise<string | null>
  setApiKey: (provider: ProviderName, key: string) => Promise<void>
  deleteApiKey: (provider: ProviderName) => Promise<void>
  testApiKey: (provider: ProviderName, key: string) => Promise<boolean>

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
  onStreamToken: (callback: (token: StreamToken) => void) => () => void
  onStreamDone: (callback: (done: StreamDone) => void) => () => void
  onStreamError: (callback: (error: { provider: ProviderName; message: string }) => void) => () => void
  onPhaseChange: (callback: (phase: { phase: string; provider?: ProviderName }) => void) => () => void

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
