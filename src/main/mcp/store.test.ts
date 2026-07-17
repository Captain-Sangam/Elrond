import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveTransport } from './store'
import { getApiKey } from '../keychain'
import { MCP_SECRET_SENTINEL, type MCPServerConfig, type MCPTransport } from '../../shared/types'

vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../keychain', () => ({
  getApiKey: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  findCredentialAccounts: vi.fn()
}))

const getApiKeyMock = vi.mocked(getApiKey)

function makeConfig(transport: MCPTransport, id = 'srv-1'): MCPServerConfig {
  return {
    id,
    name: 'Test Server',
    transport,
    enabled: true,
    source: 'custom',
    created_at: '2026-01-01T00:00:00Z'
  }
}

beforeEach(() => {
  getApiKeyMock.mockResolvedValue(null)
})

describe('resolveTransport', () => {
  it('replaces sentinel env values in a stdio transport and leaves plain values untouched', async () => {
    const config = makeConfig({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'some-server'],
      env: { API_KEY: MCP_SECRET_SENTINEL, PLAIN: 'visible' }
    })
    getApiKeyMock.mockImplementation(async (account: string) =>
      account === 'mcp:srv-1:API_KEY' ? 'real-secret' : null
    )

    const resolved = await resolveTransport(config)

    expect(resolved).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'some-server'],
      env: { API_KEY: 'real-secret', PLAIN: 'visible' }
    })
    // Only the sentinel field hits the Keychain
    expect(getApiKeyMock).toHaveBeenCalledTimes(1)
    expect(getApiKeyMock).toHaveBeenCalledWith('mcp:srv-1:API_KEY')
  })

  it('replaces sentinel header values in an http transport', async () => {
    const config = makeConfig(
      {
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: MCP_SECRET_SENTINEL, Accept: 'application/json' }
      },
      'srv-http'
    )
    getApiKeyMock.mockImplementation(async (account: string) =>
      account === 'mcp:srv-http:Authorization' ? 'Bearer tok-123' : null
    )

    const resolved = await resolveTransport(config)

    expect(resolved).toEqual({
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer tok-123', Accept: 'application/json' }
    })
  })

  it('resolves each sentinel field from its own Keychain account', async () => {
    const config = makeConfig({
      type: 'stdio',
      command: 'npx',
      args: [],
      env: { FIRST: MCP_SECRET_SENTINEL, SECOND: MCP_SECRET_SENTINEL }
    })
    getApiKeyMock.mockImplementation(async (account: string) => `secret-for:${account}`)

    const resolved = await resolveTransport(config)
    if (resolved.type !== 'stdio') throw new Error('expected stdio transport')

    expect(resolved.env).toEqual({
      FIRST: 'secret-for:mcp:srv-1:FIRST',
      SECOND: 'secret-for:mcp:srv-1:SECOND'
    })
  })

  it('throws an error naming the field when the Keychain secret is missing', async () => {
    const config = makeConfig({
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: MCP_SECRET_SENTINEL }
    })

    await expect(resolveTransport(config)).rejects.toThrow(
      'Missing Keychain secret for "Authorization" — re-enter it in Settings'
    )
  })

  it('does not mutate the input config', async () => {
    const transport: MCPTransport = {
      type: 'stdio',
      command: 'npx',
      args: ['-y'],
      env: { API_KEY: MCP_SECRET_SENTINEL }
    }
    const config = makeConfig(transport)
    const snapshot = JSON.parse(JSON.stringify(config)) as MCPServerConfig
    getApiKeyMock.mockResolvedValue('real-secret')

    const resolved = await resolveTransport(config)

    expect(config).toEqual(snapshot)
    expect(transport.env.API_KEY).toBe(MCP_SECRET_SENTINEL)
    expect(resolved).not.toBe(config.transport)
  })
})
