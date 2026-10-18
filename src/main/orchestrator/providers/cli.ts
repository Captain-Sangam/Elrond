import { execFile, spawn, type ExecFileException } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { v4 as uuidv4 } from 'uuid'
import type {
  CliMcpServer,
  SubscriptionProvider,
  SubscriptionStatus,
  SubscriptionUsage,
  UsageWindow
} from '../../../shared/types'
import { toAnthropicBlock } from './anthropic'
import {
  contentToText,
  ToolsUnsupportedError,
  type AgentProvider,
  type ChatMessage,
  type ContentPart,
  type StreamChatOptions,
  type StreamChunk,
  type ToolActivity
} from './types'

// Subscription mode: every call runs the vendor's own CLI (`claude -p`,
// `codex exec`), which authenticates with the user's subscription login and
// refreshes its own tokens — Elrond never touches those tokens. The
// credential slot carries the login-shell PATH so a Finder-launched app can
// find the binaries.

// Variables that would make a CLI bill an API account or talk to another
// endpoint instead of using the subscription
const BILLING_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'CODEX_API_KEY'
]

export function cliEnv(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: path }
  for (const key of BILLING_ENV) delete env[key]
  return env
}

// One empty directory per app run: no CLAUDE.md / AGENTS.md for the CLIs to
// discover, and scratch space for the image files Codex reads
let workDir: string | null = null
function getWorkDir(): string {
  workDir ??= mkdtempSync(join(tmpdir(), 'elrond-cli-'))
  return workDir
}

// The fields of the CLIs' JSONL events this module reads
export interface CliEvent {
  type?: string
  subtype?: string
  apiKeySource?: string
  is_error?: boolean
  result?: string
  event?: { type?: string; delta?: { type?: string; text?: string } }
  // Claude assistant (tool_use) and user (tool_result) messages
  message?: {
    content?: {
      type?: string
      id?: string
      name?: string
      input?: unknown
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
    }[]
  }
  // Codex items; mcp_tool_call carries server/tool/arguments/result/error
  item?: {
    type?: string
    text?: string
    id?: string
    server?: string
    tool?: string
    arguments?: unknown
    result?: { content?: unknown } | null
    error?: { message?: string } | string | null
    status?: string
  }
  error?: { message?: string }
  rate_limit_info?: { unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }> }
}

// Runs a CLI with `input` on stdin and yields its stdout JSONL events
async function* runCli(
  cmd: string,
  args: string[],
  input: string,
  path: string,
  signal?: AbortSignal,
  extraEnv?: NodeJS.ProcessEnv
): AsyncGenerator<CliEvent> {
  // `signal` SIGTERMs the child when the deliberation is cancelled
  const child = spawn(cmd, args, { cwd: getWorkDir(), env: { ...cliEnv(path), ...extraEnv }, signal })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  exited.catch(() => {}) // awaited below; don't flag it unhandled meanwhile
  child.stdin.on('error', () => {}) // EPIPE when the CLI dies before reading
  child.stdin.end(input)

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  // A killed CLI's stdout can stay open if anything inherited it — stop
  // reading on abort rather than waiting for EOF
  signal?.addEventListener('abort', () => lines.close(), { once: true })
  for await (const line of lines) {
    let event: CliEvent
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    yield event
  }

  let code: number | null
  try {
    code = await exited
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${cmd} CLI not found — install it and log in, or switch this provider back to an API key`)
    }
    throw err
  }
  if (code !== 0 && !signal?.aborted) {
    throw new Error(stderr.trim() || `${cmd} exited with code ${code}`)
  }
}

export interface ParsedEvent {
  text?: string
  done?: boolean
  tools?: ToolActivity[]
}

// Maps events to text chunks. `parse` throws on error events and reports
// done on the completion event — a stream that ends without one means the CLI
// died mid-answer, and partial text must not pass as a finished answer.
export async function* toChunks(
  events: AsyncIterable<CliEvent>,
  parse: (event: CliEvent) => ParsedEvent | undefined,
  cli: string
): AsyncIterable<StreamChunk> {
  let done = false
  for await (const event of events) {
    const parsed = parse(event)
    if (parsed?.text) yield { type: 'text', delta: parsed.text }
    for (const activity of parsed?.tools ?? []) yield { type: 'tool_activity', activity }
    if (parsed?.done) done = true
  }
  if (!done) throw new Error(`${cli} exited before finishing its answer`)
}

// Tool results arrive as a string or as MCP content blocks
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: { type?: string; text?: string }) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '[non-text content omitted]'))
      .join('\n')
  }
  return content === undefined || content === null ? '' : JSON.stringify(content)
}

// Claude names MCP tools mcp__<server>__<tool>
function splitClaudeToolName(name: string): { serverName: string; toolName: string } {
  const rest = name.startsWith('mcp__') ? name.slice(5) : name
  const sep = rest.indexOf('__')
  return sep === -1 ? { serverName: 'claude', toolName: rest } : { serverName: rest.slice(0, sep), toolName: rest.slice(sep + 2) }
}

// Stateful: a tool_result only names its tool_use id, so calls are kept to
// label the result
export function createClaudeParser(): (e: CliEvent) => ParsedEvent | undefined {
  const calls = new Map<string, Omit<ToolActivity, 'status'>>()
  return (e) => {
    // 'none' means the subscription login; anything else is an API key that
    // would bill per token
    if (e.type === 'system' && e.subtype === 'init' && e.apiKeySource && e.apiKeySource !== 'none') {
      throw new Error(
        `Claude Code is using an API key (${e.apiKeySource}), not your subscription — run \`claude auth login\` with your Claude account`
      )
    }
    if (e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event.delta?.type === 'text_delta') {
      return { text: e.event.delta.text }
    }
    if (e.type === 'assistant') {
      const tools = (e.message?.content ?? [])
        .filter((b) => b.type === 'tool_use' && b.id)
        .map((b) => {
          const call = { callId: b.id!, ...splitClaudeToolName(b.name ?? ''), argsJson: JSON.stringify(b.input ?? {}) }
          calls.set(call.callId, call)
          return { ...call, status: 'running' as const }
        })
      return tools.length ? { tools } : undefined
    }
    if (e.type === 'user') {
      const tools = (e.message?.content ?? [])
        .filter((b) => b.type === 'tool_result' && calls.has(b.tool_use_id ?? ''))
        .map((b) => ({
          ...calls.get(b.tool_use_id!)!,
          status: b.is_error ? ('error' as const) : ('ok' as const),
          resultText: toolResultText(b.content)
        }))
      return tools.length ? { tools } : undefined
    }
    // The result repeats the streamed text — only its error flag matters
    if (e.type === 'result') {
      if (e.is_error) throw new Error(e.result || `Claude Code failed (${e.subtype ?? 'unknown error'})`)
      return { done: true }
    }
    return undefined
  }
}

// Codex wraps API errors as a JSON string inside the message
function codexErrorMessage(raw: string | undefined): string {
  try {
    return JSON.parse(raw ?? '').error.message ?? raw
  } catch {
    return raw || 'Codex failed'
  }
}

// Stateful so several agent messages in one turn don't run together. Codex
// also emits non-fatal `error` items (e.g. unknown model metadata) — only
// turn.failed ends the call.
export function createCodexParser(): (e: CliEvent) => ParsedEvent | undefined {
  let messages = 0
  return (e) => {
    if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text) {
      return { text: (messages++ ? '\n\n' : '') + e.item.text }
    }
    const it = e.item
    if (it?.type === 'mcp_tool_call' && (e.type === 'item.started' || e.type === 'item.completed')) {
      const failed = it.status === 'failed' || !!it.error
      const errorText = typeof it.error === 'string' ? it.error : (it.error?.message ?? 'Tool call failed')
      return {
        tools: [
          {
            callId: it.id ?? '',
            toolName: it.tool ?? '',
            serverName: it.server ?? '',
            argsJson: typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments ?? {}),
            status: e.type === 'item.started' ? 'running' : failed ? 'error' : 'ok',
            resultText: e.type === 'item.started' ? undefined : failed ? errorText : toolResultText(it.result?.content)
          }
        ]
      }
    }
    if (e.type === 'turn.completed') return { done: true }
    if (e.type === 'turn.failed') throw new Error(codexErrorMessage(e.error?.message))
    return undefined
  }
}

const ROLE_LABELS: Record<ChatMessage['role'], string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool'
}

// A fresh CLI process has no conversation state, so the whole history —
// system prompt included — goes in as one role-labelled message on stdin
// (the system prompt carries repo and web context that can exceed argv limits)
function labelled(m: ChatMessage): string {
  return `${ROLE_LABELS[m.role]}:\n${contentToText(m.content)}`
}

function nonTextParts(m: ChatMessage): ContentPart[] {
  return typeof m.content === 'string' ? [] : m.content.filter((p) => p.type !== 'text')
}

// Earlier turns keep their attachments: the runner replays them so follow-up
// questions about a file still work
export function claudeInput(messages: ChatMessage[]): string {
  const content = messages.flatMap((m) => [
    { type: 'text', text: labelled(m) },
    ...nonTextParts(m).map(toAnthropicBlock)
  ])
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
}

export function codexPrompt(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const omitted = nonTextParts(m)
        .filter((p): p is Extract<ContentPart, { type: 'file' }> => p.type === 'file')
        .map((p) => `[Attachment "${p.fileName}" omitted — Codex does not support document input]`)
      return [labelled(m), ...omitted].join('\n')
    })
    .join('\n\n')
}

const CLAUDE_SYSTEM_PROMPT =
  'You are one participant in a multi-agent deliberation. The user message contains the conversation so far as role-labelled sections. Follow the instructions in the System section and answer the final User section directly.'

function rejectTools(cli: string, model: string, options?: StreamChatOptions): void {
  // Elrond's MCP tools can't be bridged into the CLI; the tool loop catches
  // this and answers without tools
  if (options?.tools?.length) {
    throw new ToolsUnsupportedError(
      model,
      `${cli} subscription agents can't use Elrond's MCP servers (choose ${cli} servers in Settings → Providers)`
    )
  }
}

// Permission rule allowing every tool of one MCP server; Claude derives tool
// prefixes from server names this way (e.g. "claude.ai Docs" → claude_ai_Docs)
export function claudeServerRule(name: string): string {
  return `mcp__${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

// Where Claude Code reads permission rules for a run in an empty directory:
// the user's settings and macOS managed (enterprise) settings
const CLAUDE_SETTINGS_FILES = [
  join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json'),
  '/Library/Application Support/ClaudeCode/managed-settings.json'
]

// dontAsk still honours permissions.allow, so an MCP rule the user already
// pre-approved in Claude Code would let an unselected server run. Returns
// those rules so they can be denied (deny beats allow). Reads nothing but
// permissions.allow — settings can carry an env block with keys.
export function unselectedMcpPreApprovals(selectedRules: string[], files = CLAUDE_SETTINGS_FILES): string[] {
  const rules = files.flatMap((file) => {
    try {
      const allow = JSON.parse(readFileSync(file, 'utf8'))?.permissions?.allow
      return Array.isArray(allow) ? allow.filter((r): r is string => typeof r === 'string' && r.startsWith('mcp__')) : []
    } catch {
      return [] // missing or unreadable — no rules
    }
  })
  return rules.filter((rule) => !selectedRules.some((s) => rule === s || rule.startsWith(`${s}__`)))
}

export class ClaudeCliProvider implements AgentProvider {
  // Distinct from 'anthropic' so the tool loop's tools-unsupported cache
  // never leaks into API mode
  readonly name = 'claude-cli'

  // The user's Claude Code MCP servers they opted into (none = isolated run)
  constructor(private readonly mcpServers: () => string[] = () => []) {}

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    options?: StreamChatOptions
  ): AsyncIterable<StreamChunk> {
    const servers = options?.toolsAllowed ? this.mcpServers() : []
    // Elrond's own MCP tools can't be bridged in; with opted-in CLI servers
    // those stand in silently, otherwise the tool loop notes the fallback
    if (servers.length === 0) rejectTools('Claude Code', model, options)
    const allowed = servers.map(claudeServerRule)
    const denied = servers.length ? unselectedMcpPreApprovals(allowed) : []
    const isolation = servers.length
      ? [
          // User MCP servers need the user's config, so no --safe-mode — keep
          // hooks and skills off instead, and run only the chosen servers'
          // tools: headless, anything not pre-approved is refused
          '--settings', '{"disableAllHooks":true}',
          '--disable-slash-commands',
          '--permission-mode', 'dontAsk',
          '--allowedTools', allowed.join(','),
          ...(denied.length ? ['--disallowedTools', denied.join(',')] : [])
        ]
      : [
          // No user CLAUDE.md, hooks, plugins or MCP servers; auth still works
          // (never --bare: it skips the subscription login entirely)
          '--safe-mode',
          '--strict-mcp-config'
        ]
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...isolation,
      '--tools', '',
      '--no-session-persistence',
      '--model', model,
      '--system-prompt', CLAUDE_SYSTEM_PROMPT
    ]
    const env = servers.length
      ? {
          CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          // -p otherwise starts before slow servers connect and lacks their tools.
          // ponytail: waits on all of the user's servers, not just the chosen
          // ones — a per-server --mcp-config would need their full configs
          CLAUDE_CODE_MCP_STARTUP_WAIT_MS: '15000'
        }
      : undefined
    const parse = createClaudeParser()
    yield* toChunks(
      runCli('claude', args, claudeInput(messages), credential, options?.signal, env),
      (event) => {
        if (event.type === 'rate_limit_event') {
          claudeUsage = parseClaudeUsage(event.rate_limit_info, Date.now()) ?? claudeUsage
        }
        return parse(event)
      },
      'Claude Code'
    )
  }
}

// Codex flags that keep plugin and app (connector) servers out — shared by
// runs and the server listing so both see the same set
const CODEX_NO_PLUGINS = ['--disable', 'plugins', '--disable', 'apps']

// Codex runs MCP tools without asking, so every server the user didn't pick
// is switched off for the run. Fails closed: if the server list can't be
// read, the run ignores the user's config (and with it all MCP servers).
async function codexMcpArgs(selected: string[], path: string): Promise<string[]> {
  const all = await listCodexMcpServers(path)
  if (!all) return ['--ignore-user-config']
  const unselected = all.filter((s) => !selected.includes(s.name))
  // -c takes a dotted path and doesn't parse quoted keys, so a name like
  // "a.b" can't be switched off (codex then fails to load its config)
  if (unselected.some((s) => !/^[\w-]+$/.test(s.name))) return ['--ignore-user-config']
  return [
    ...unselected.flatMap((s) => ['-c', `mcp_servers.${s.name}.enabled=false`]),
    // The user's config may route calls to a custom (API-billed) provider
    '-c', 'model_provider="openai"',
    // ...or run a program after every turn
    '-c', 'notify=[]'
  ]
}

export class CodexCliProvider implements AgentProvider {
  readonly name = 'codex-cli'

  // The user's Codex MCP servers they opted into (none = isolated run)
  constructor(private readonly mcpServers: () => string[] = () => []) {}

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    options?: StreamChatOptions
  ): AsyncIterable<StreamChunk> {
    const servers = options?.toolsAllowed ? this.mcpServers() : []
    if (servers.length === 0) rejectTools('Codex', model, options)
    const config = servers.length ? await codexMcpArgs(servers, credential) : ['--ignore-user-config']
    // Codex only takes images as files; uuids keep parallel calls apart
    const images = messages
      .flatMap(nonTextParts)
      .filter((p): p is Extract<ContentPart, { type: 'image' }> => p.type === 'image')
      .map((p) => {
        const file = join(getWorkDir(), `${uuidv4()}.${p.mimeType.split('/')[1] || 'png'}`)
        writeFileSync(file, Buffer.from(p.data, 'base64'))
        return file
      })
    try {
      const args = [
        'exec',
        '--json',
        '--ephemeral',
        '--skip-git-repo-check',
        ...config,
        '--ignore-rules',
        '--disable', 'shell_tool',
        '--disable', 'hooks',
        ...CODEX_NO_PLUGINS,
        // Refuse API-key auth at run time, and keep synthesis from pulling in
        // un-debated facts through web search (on by default)
        '-c', 'forced_login_method="chatgpt"',
        '-c', 'web_search="disabled"',
        '--sandbox', 'read-only',
        '-C', getWorkDir(),
        // -i takes several values, so it must precede -m; '-' (stdin) stays last
        ...images.flatMap((file) => ['-i', file]),
        '-m', model,
        '-'
      ]
      yield* toChunks(
        runCli('codex', args, codexPrompt(messages), credential, options?.signal),
        createCodexParser(),
        'Codex'
      )
    } finally {
      for (const file of images) rmSync(file, { force: true })
    }
  }
}

// The CLI's always-latest aliases. sonnet first: list[0] is the default for
// new agents and every plan tier can run it.
export const CLAUDE_CLI_MODELS = ['sonnet', 'opus', 'haiku', 'fable']

function execCli(
  cmd: string,
  args: string[],
  path: string,
  timeout = 10_000
): Promise<{ error: ExecFileException | null; output: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: getWorkDir(), env: cliEnv(path), timeout, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, output: `${stdout}\n${stderr}` })
    )
  })
}

export async function listCodexModels(path: string): Promise<string[]> {
  const { output } = await execCli('codex', ['debug', 'models'], path)
  try {
    const { models } = JSON.parse(output.trim()) as { models: { slug: string; visibility?: string }[] }
    return models.filter((m) => m.visibility === 'list').map((m) => m.slug)
  } catch {
    return [] // the model field falls back to free text
  }
}

// Asks the CLI itself whether it's logged in — no token is read here
export async function detectSubscription(
  provider: SubscriptionProvider,
  path: string
): Promise<SubscriptionStatus> {
  const cli = provider === 'anthropic' ? 'claude' : 'codex'
  const { error, output } = await execCli(
    cli,
    provider === 'anthropic' ? ['auth', 'status', '--json'] : ['login', 'status'],
    path
  )
  if (error?.code === 'ENOENT') return { ok: false, detail: `${cli} CLI not found — install it, then log in` }
  if (error?.killed) return { ok: false, detail: `${cli} did not respond — try again` }

  if (provider === 'anthropic') {
    try {
      const status = JSON.parse(output.trim()) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string }
      if (status.loggedIn && status.authMethod === 'claude.ai') {
        return { ok: true, detail: `Logged in · ${status.subscriptionType ?? 'Claude'} plan` }
      }
      if (status.loggedIn) {
        return { ok: false, detail: 'Claude Code is logged in with an API account — run `claude auth login` with your Claude subscription' }
      }
    } catch {
      // unparseable output reads as logged out
    }
    return { ok: false, detail: 'Not logged in — run `claude` in a terminal and log in' }
  }

  if (!error && /chatgpt/i.test(output)) return { ok: true, detail: 'Logged in with ChatGPT' }
  if (!error) return { ok: false, detail: 'Codex is logged in with an API key — run `codex login` with your ChatGPT account' }
  return { ok: false, detail: 'Not logged in — run `codex login` in a terminal' }
}

// Plan usage — how much of each rate-limit window is used, as the CLIs report it

const CLAUDE_WINDOW_MINUTES: Record<string, number> = { five_hour: 300, seven_day: 10080 }

export function windowLabel(minutes: number | null | undefined, fallback = 'Limit'): string {
  if (!minutes) return fallback
  if (minutes === 10080) return 'Weekly'
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

// Claude Code has no usage command — it reports limits only as a
// rate_limit_event during a run, so this is the reading from the last call
let claudeUsage: SubscriptionUsage | null = null

export function getClaudeUsage(): SubscriptionUsage | null {
  return claudeUsage
}

// utilization is a 0–1 fraction; resetsAt is epoch seconds
export function parseClaudeUsage(info: CliEvent['rate_limit_info'], now: number): SubscriptionUsage | null {
  const windows: UsageWindow[] = Object.entries(info?.unifiedWindows ?? {}).map(([key, w]) => ({
    label: windowLabel(CLAUDE_WINDOW_MINUTES[key], key.replace(/_/g, ' ')),
    usedPercent: Math.round((w.utilization ?? 0) * 100),
    resetsAt: w.resetsAt ? w.resetsAt * 1000 : null
  }))
  return windows.length ? { windows, checkedAt: now } : null
}

interface CodexWindow {
  usedPercent: number
  windowDurationMins?: number | null
  resetsAt?: number | null
}

// Which windows exist depends on the plan (some have only a weekly one), so
// labels come from each window's length; resetsAt is epoch seconds
export function parseCodexUsage(
  result: { rateLimits?: { primary?: CodexWindow | null; secondary?: CodexWindow | null } } | undefined,
  now: number
): SubscriptionUsage | null {
  const limits = result?.rateLimits
  const windows: UsageWindow[] = [limits?.primary, limits?.secondary]
    .filter((w): w is CodexWindow => !!w)
    .map((w) => ({
      label: windowLabel(w.windowDurationMins),
      usedPercent: w.usedPercent,
      resetsAt: w.resetsAt ? w.resetsAt * 1000 : null
    }))
  return windows.length ? { windows, checkedAt: now } : null
}

// Codex reports limits without a model call through its app-server protocol
// (JSON-RPC over stdio): initialize, then account/rateLimits/read.
// ponytail: app-server is marked experimental — any failure resolves null and
// just hides the usage block; deliberations never depend on it
export function readCodexUsage(path: string): Promise<SubscriptionUsage | null> {
  return new Promise((resolve) => {
    const child = spawn('codex', ['app-server'], { cwd: getWorkDir(), env: cliEnv(path) })
    const finish = (usage: SubscriptionUsage | null): void => {
      clearTimeout(timer)
      child.kill()
      resolve(usage)
    }
    const timer = setTimeout(() => finish(null), 10_000)
    const send = (message: object): void => {
      child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.on('error', () => finish(null))
    child.on('close', () => finish(null))
    child.stdin.on('error', () => {})
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message: { id?: number; result?: unknown }
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.id === 1) {
        send({ method: 'initialized' })
        send({ id: 2, method: 'account/rateLimits/read', params: null })
      } else if (message.id === 2) {
        finish(parseCodexUsage(message.result as Parameters<typeof parseCodexUsage>[0], Date.now()))
      }
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'elrond', version: '1.0' } } })
  })
}

// MCP servers configured in the user's CLIs (for the opt-in picker)

// `claude mcp list` prints "name: target - status" lines after a header
export function parseClaudeMcpList(output: string): CliMcpServer[] {
  return output.split('\n').flatMap((line) => {
    const nameEnd = line.indexOf(': ')
    const statusStart = line.lastIndexOf(' - ')
    if (nameEnd <= 0 || statusStart <= nameEnd) return []
    return [{ name: line.slice(0, nameEnd).trim(), status: line.slice(statusStart + 3).trim() }]
  })
}

// Enabled servers from config.toml; null when the list can't be read
async function listCodexMcpServers(path: string): Promise<CliMcpServer[] | null> {
  const { error, output } = await execCli('codex', [...CODEX_NO_PLUGINS, 'mcp', 'list', '--json'], path)
  if (error) return null
  try {
    const servers = JSON.parse(output.trim()) as { name: string; enabled?: boolean; auth_status?: string }[]
    // Codex doesn't health-check servers here; only a missing OAuth login is worth showing
    return servers
      .filter((s) => s.enabled !== false)
      .map((s) => ({ name: s.name, status: s.auth_status === 'not_logged_in' ? '! Needs authentication' : '' }))
  } catch {
    return null
  }
}

export async function listCliMcpServers(provider: SubscriptionProvider, path: string): Promise<CliMcpServer[]> {
  if (provider === 'openai') return (await listCodexMcpServers(path)) ?? []
  // Health-checks every server, so it's slow (~30s with many servers)
  const { output } = await execCli('claude', ['mcp', 'list'], path, 90_000)
  return parseClaudeMcpList(output)
}

// Re-checks one server for the chooser: Claude health-checks it (~2s),
// Codex re-reads its config. Each agent call connects afresh anyway, so this
// only refreshes the shown status.
export async function checkCliMcpServer(
  provider: SubscriptionProvider,
  name: string,
  path: string
): Promise<CliMcpServer> {
  if (provider === 'openai') {
    return (await listCodexMcpServers(path))?.find((s) => s.name === name) ?? { name, status: 'not found' }
  }
  const { output } = await execCli('claude', ['mcp', 'get', name], path, 30_000)
  return { name, status: /^\s*Status:\s*(.+)$/m.exec(output)?.[1]?.trim() ?? 'not found' }
}
