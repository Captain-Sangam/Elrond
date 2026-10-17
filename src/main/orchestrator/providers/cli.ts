import { execFile, spawn, type ExecFileException } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { v4 as uuidv4 } from 'uuid'
import type { SubscriptionProvider, SubscriptionStatus } from '../../../shared/types'
import { toAnthropicBlock } from './anthropic'
import {
  contentToText,
  ToolsUnsupportedError,
  type AgentProvider,
  type ChatMessage,
  type ContentPart,
  type StreamChatOptions,
  type StreamChunk
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
  item?: { type?: string; text?: string }
  error?: { message?: string }
}

// Runs a CLI with `input` on stdin and yields its stdout JSONL events
async function* runCli(
  cmd: string,
  args: string[],
  input: string,
  path: string,
  signal?: AbortSignal
): AsyncGenerator<CliEvent> {
  // `signal` SIGTERMs the child when the deliberation is cancelled
  const child = spawn(cmd, args, { cwd: getWorkDir(), env: cliEnv(path), signal })
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
    if (parsed?.done) done = true
  }
  if (!done) throw new Error(`${cli} exited before finishing its answer`)
}

export function parseClaudeEvent(e: CliEvent): ParsedEvent | undefined {
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
  // The result repeats the streamed text — only its error flag matters
  if (e.type === 'result') {
    if (e.is_error) throw new Error(e.result || `Claude Code failed (${e.subtype ?? 'unknown error'})`)
    return { done: true }
  }
  return undefined
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
    throw new ToolsUnsupportedError(model, `${cli} subscription mode has no MCP tools`)
  }
}

export class ClaudeCliProvider implements AgentProvider {
  // Distinct from 'anthropic' so the tool loop's tools-unsupported cache
  // never leaks into API mode
  readonly name = 'claude-cli'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    options?: StreamChatOptions
  ): AsyncIterable<StreamChunk> {
    rejectTools('Claude Code', model, options)
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // No user CLAUDE.md, hooks, plugins or MCP servers; auth still works
      // (never --bare: it skips the subscription login entirely)
      '--safe-mode',
      '--tools', '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--model', model,
      '--system-prompt', CLAUDE_SYSTEM_PROMPT
    ]
    yield* toChunks(
      runCli('claude', args, claudeInput(messages), credential, options?.signal),
      parseClaudeEvent,
      'Claude Code'
    )
  }
}

export class CodexCliProvider implements AgentProvider {
  readonly name = 'codex-cli'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    options?: StreamChatOptions
  ): AsyncIterable<StreamChunk> {
    rejectTools('Codex', model, options)
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
        '--ignore-user-config',
        '--ignore-rules',
        '--disable', 'shell_tool',
        '--disable', 'hooks',
        '--disable', 'plugins',
        '--disable', 'apps',
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
  path: string
): Promise<{ error: ExecFileException | null; output: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: getWorkDir(), env: cliEnv(path), timeout: 10_000, maxBuffer: 10 * 1024 * 1024 },
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
