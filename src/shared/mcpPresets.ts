import { MCP_SECRET_SENTINEL, type MCPPresetId, type MCPTransport } from './types'

export interface MCPPresetSecretField {
  // Env var (stdio) or header name (http) the secret is delivered through
  field: string
  label: string
  placeholder: string
  // Applied before Keychain storage, e.g. 'Bearer {value}'
  valueTemplate?: string
}

export interface MCPPreset {
  id: MCPPresetId
  label: string
  description: string
  transport: MCPTransport
  secretFields: MCPPresetSecretField[]
  // Filesystem: picked directories are appended to transport.args
  needsDirectoryPicker?: boolean
  oauthNote?: string
}

const OAUTH_NOTE = 'A browser window will open to authorize on first connect.'

export const MCP_PRESETS: MCPPreset[] = [
  {
    id: 'linear',
    label: 'Linear',
    description: 'Issues, projects, and cycles from your Linear workspace.',
    transport: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'], env: {} },
    secretFields: [],
    oauthNote: OAUTH_NOTE
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Search and read pages and databases from your Notion workspace.',
    transport: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.notion.com/mcp'], env: {} },
    secretFields: [],
    oauthNote: OAUTH_NOTE
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Repositories, issues, PRs, and code via the hosted GitHub MCP server.',
    transport: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: MCP_SECRET_SENTINEL }
    },
    secretFields: [
      {
        field: 'Authorization',
        label: 'Personal Access Token',
        placeholder: 'ghp_...',
        valueTemplate: 'Bearer {value}'
      }
    ]
  },
  {
    id: 'sentry',
    label: 'Sentry',
    description: 'Errors, issues, and traces from your Sentry organization.',
    transport: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.sentry.dev/mcp'], env: {} },
    secretFields: [],
    oauthNote: OAUTH_NOTE
  },
  {
    id: 'context7',
    label: 'Context7',
    description: 'Up-to-date documentation for libraries and frameworks.',
    transport: {
      type: 'http',
      url: 'https://mcp.context7.com/mcp',
      headers: { CONTEXT7_API_KEY: MCP_SECRET_SENTINEL }
    },
    secretFields: [
      { field: 'CONTEXT7_API_KEY', label: 'API Key', placeholder: 'ctx7sk-...' }
    ]
  },
  {
    id: 'filesystem',
    label: 'Filesystem',
    description: 'Read files and directories from folders you choose on this Mac.',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: {}
    },
    secretFields: [],
    needsDirectoryPicker: true
  }
]

export function getPreset(id: string): MCPPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id)
}
