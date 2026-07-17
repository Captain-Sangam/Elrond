import { createServer, type Server } from 'http'
import { shell } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { getApiKey, setApiKey, deleteApiKey } from '../keychain'

// Fixed port: the redirect URI is registered with the authorization server at
// dynamic client registration, so it must be stable across app restarts
const CALLBACK_PORT = 17872
const CALLBACK_PATH = '/oauth/callback'
const AUTH_TIMEOUT_MS = 300_000 // user has 5 minutes to approve in the browser

const CALLBACK_HTML = `<!doctype html><meta charset="utf-8"><title>Elrond</title>
<body style="font-family:-apple-system,sans-serif;display:grid;place-items:center;height:90vh;background:#111;color:#eee">
<div style="text-align:center"><h2>✻ Connected</h2><p>Authorization complete — you can close this tab and return to Elrond.</p></div>`

// ---------------------------------------------------------------------------
// Loopback callback server — runs only while an authorization is pending

interface PendingAuth {
  resolve: (code: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const pendingAuths = new Map<string, PendingAuth>()
let callbackServer: Server | null = null

function stopServerIfIdle(): void {
  if (pendingAuths.size === 0 && callbackServer) {
    callbackServer.close()
    callbackServer = null
  }
}

function ensureCallbackServer(): Promise<void> {
  if (callbackServer) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${CALLBACK_PORT}`)
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end('Not found')
        return
      }
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      // Route by state; a non-compliant server that drops it can still be
      // matched when only one authorization is in flight
      const pending =
        (state && pendingAuths.get(state)) ||
        (pendingAuths.size === 1 ? [...pendingAuths.values()][0] : undefined)
      const pendingKey =
        (state && pendingAuths.has(state) && state) ||
        (pendingAuths.size === 1 ? [...pendingAuths.keys()][0] : undefined)

      if (!pending || !pendingKey) {
        res.writeHead(400).end('No authorization in progress')
        return
      }
      pendingAuths.delete(pendingKey)
      clearTimeout(pending.timer)
      stopServerIfIdle()

      if (error || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          `<body style="font-family:sans-serif">Authorization failed: ${error ?? 'no code returned'}. You can close this tab.`
        )
        pending.reject(new Error(`Authorization failed: ${error ?? 'no code returned'}`))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(CALLBACK_HTML)
      pending.resolve(code)
    })
    server.once('error', (err) => reject(new Error(`OAuth callback server failed: ${err.message}`)))
    server.listen(CALLBACK_PORT, '127.0.0.1', () => resolve())
    callbackServer = server
  })
}

export async function waitForAuthorizationCode(state: string): Promise<string> {
  await ensureCallbackServer()
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAuths.delete(state)
      stopServerIfIdle()
      reject(new Error('Authorization timed out — click reconnect to sign in again'))
    }, AUTH_TIMEOUT_MS)
    pendingAuths.set(state, { resolve, reject, timer })
  })
}

export function cancelPendingAuth(state: string): void {
  const pending = pendingAuths.get(state)
  if (pending) {
    pendingAuths.delete(state)
    clearTimeout(pending.timer)
    pending.reject(new Error('Authorization cancelled'))
    stopServerIfIdle()
  }
}

// ---------------------------------------------------------------------------
// Per-server OAuth provider with Keychain persistence

interface OAuthBlob {
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  verifier?: string
}

function oauthAccount(serverId: string): string {
  return `mcp:${serverId}:oauth`
}

// Implements the SDK's OAuthClientProvider: dynamic client registration,
// PKCE, and token storage — everything lands in one Keychain entry per
// server, which the existing delete-sweep (`mcp:<id>:*`) cleans up.
export class KeychainOAuthProvider implements OAuthClientProvider {
  private blob: OAuthBlob | null = null
  // The state of the most recent authorization redirect — the manager waits
  // on the loopback callback with it
  lastState: string | null = null

  constructor(private readonly serverId: string) {}

  private async load(): Promise<OAuthBlob> {
    if (!this.blob) {
      const raw = await getApiKey(oauthAccount(this.serverId))
      this.blob = raw ? (JSON.parse(raw) as OAuthBlob) : {}
    }
    return this.blob
  }

  private async save(patch: Partial<OAuthBlob>): Promise<void> {
    const blob = { ...(await this.load()), ...patch }
    this.blob = blob
    await setApiKey(oauthAccount(this.serverId), JSON.stringify(blob))
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Elrond',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    this.lastState = uuidv4()
    return this.lastState
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.load()).client
  }

  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.save({ client })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.load()).tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.save({ tokens })
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await shell.openExternal(authorizationUrl.toString())
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.save({ verifier })
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.load()).verifier
    if (!verifier) throw new Error('No PKCE code verifier saved — restart the authorization')
    return verifier
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all') {
      this.blob = {}
      await deleteApiKey(oauthAccount(this.serverId)).catch(() => {})
      return
    }
    const blob = await this.load()
    if (scope === 'client') delete blob.client
    if (scope === 'tokens') delete blob.tokens
    if (scope === 'verifier') delete blob.verifier
    this.blob = blob
    await setApiKey(oauthAccount(this.serverId), JSON.stringify(blob))
  }
}
