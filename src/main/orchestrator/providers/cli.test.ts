import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkCliMcpServer,
  ClaudeCliProvider,
  CodexCliProvider,
  claudeInput,
  claudeServerRule,
  codexPrompt,
  createCodexParser,
  getClaudeUsage,
  listCliMcpServers,
  createClaudeParser,
  parseClaudeMcpList,
  parseClaudeUsage,
  parseCodexUsage,
  readCodexUsage,
  toChunks,
  unselectedMcpPreApprovals,
  windowLabel,
  type CliEvent
} from './cli'
import { ToolsUnsupportedError, type ChatMessage, type StreamChunk, type ToolActivity } from './types'

// Trimmed from real runs of claude 2.1.295 and codex-cli 0.162.1
const CLAUDE_OK = [
  { type: 'system', subtype: 'init', apiKeySource: 'none', model: 'claude-haiku-5-5', tools: [] },
  { type: 'stream_event', event: { type: 'message_start' } },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'O' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'K' } } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'OK' }
]
const CLAUDE_BAD_MODEL = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  result: "There's an issue with the selected model (bogus-model-x). It may not exist or you may not have access to it."
}
const CODEX_OK = [
  { type: 'thread.started', thread_id: 't1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'OK' } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }
]
const CODEX_BAD_MODEL = [
  { type: 'thread.started', thread_id: 't1' },
  { type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Model metadata for `bogus-model-x` not found.' } },
  { type: 'turn.started' },
  {
    type: 'turn.failed',
    error: {
      message:
        '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'bogus-model-x\' model is not supported when using Codex with a ChatGPT account."}}'
    }
  }
]

async function* events(list: CliEvent[]): AsyncIterable<CliEvent> {
  yield* list
}

async function activities(stream: AsyncIterable<StreamChunk>): Promise<ToolActivity[]> {
  const found: ToolActivity[] = []
  for await (const chunk of stream) if (chunk.type === 'tool_activity') found.push(chunk.activity)
  return found
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) if (chunk.type === 'text') text += chunk.delta
  return text
}

describe('Claude stream-json events', () => {
  it('streams text deltas once, ignoring the repeated final text', async () => {
    await expect(collect(toChunks(events(CLAUDE_OK), createClaudeParser(), 'Claude Code'))).resolves.toBe('OK')
  })

  it('throws the CLI message on an error result', async () => {
    await expect(collect(toChunks(events([CLAUDE_BAD_MODEL]), createClaudeParser(), 'Claude Code'))).rejects.toThrow(
      'issue with the selected model'
    )
  })

  it('refuses to run on an API key instead of the subscription', () => {
    expect(() => createClaudeParser()({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' })).toThrow(
      'not your subscription'
    )
  })

  it('treats a stream without a result as an unfinished answer', async () => {
    await expect(collect(toChunks(events(CLAUDE_OK.slice(0, 4)), createClaudeParser(), 'Claude Code'))).rejects.toThrow(
      'exited before finishing'
    )
  })
})

describe('CLI tool calls', () => {
  it('reports Claude MCP calls with their results', async () => {
    // Shapes from a real claude -p run calling a Prometheus MCP tool
    const run = [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__prometheus-app-mcp-server__health_check', input: {} }] }
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '{"status":"healthy"}' }] }] }
      },
      { type: 'result', subtype: 'success', is_error: false, result: 'Healthy' }
    ]
    expect(await activities(toChunks(events(run), createClaudeParser(), 'Claude Code'))).toEqual([
      { callId: 'toolu_1', serverName: 'prometheus-app-mcp-server', toolName: 'health_check', argsJson: '{}', status: 'running' },
      {
        callId: 'toolu_1',
        serverName: 'prometheus-app-mcp-server',
        toolName: 'health_check',
        argsJson: '{}',
        status: 'ok',
        resultText: '{"status":"healthy"}'
      }
    ])
  })

  it('reports a refused Claude call as an error', async () => {
    const run = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'mcp__k8s__pods_delete', input: { name: 'x' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'Claude requested permissions to use mcp__k8s__pods_delete, but you haven\'t granted it yet.' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: '' }
    ]
    const [, done] = await activities(toChunks(events(run), createClaudeParser(), 'Claude Code'))
    expect(done).toMatchObject({ status: 'error', serverName: 'k8s', toolName: 'pods_delete', argsJson: '{"name":"x"}' })
  })

  it('reports Codex MCP calls with their results', async () => {
    // Shapes from a real codex exec run
    const item = { id: 'item_1', type: 'mcp_tool_call', server: 'prometheus-app-mcp-server', tool: 'health_check', arguments: '{}' }
    const run = [
      { type: 'item.started', item: { ...item, result: null, error: null, status: 'in_progress' } },
      {
        type: 'item.completed',
        item: { ...item, result: { content: [{ type: 'text', text: '{"status":"healthy"}' }] }, error: null, status: 'completed' }
      },
      { type: 'turn.completed' }
    ]
    expect((await activities(toChunks(events(run), createCodexParser(), 'Codex'))).map((a) => [a.status, a.resultText])).toEqual([
      ['running', undefined],
      ['ok', '{"status":"healthy"}']
    ])
  })
})

describe('Claude pre-approved MCP rules', () => {
  it('returns allow rules for servers the user did not select, so they can be denied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elrond-settings-'))
    const user = join(dir, 'settings.json')
    writeFileSync(
      user,
      JSON.stringify({
        env: { SECRET: 'x' },
        permissions: { allow: ['mcp__keep', 'mcp__keep__query', 'mcp__k8s__pods_delete', 'mcp__keep-extra', 'Bash(ls)'] }
      })
    )
    expect(unselectedMcpPreApprovals(['mcp__keep'], [user, join(dir, 'missing.json')])).toEqual([
      'mcp__k8s__pods_delete',
      'mcp__keep-extra'
    ])
  })
})

describe('CLI MCP server listing', () => {
  it('parses claude mcp list output', () => {
    const output = [
      'Checking MCP server health…',
      '',
      'claude.ai Claude Docs: https://mcp.example.com/docs - ✓ Connected',
      'prometheus-app-mcp-server: /usr/local/bin/prom-mcp --stdio - ✓ Connected',
      'linear: npx -y mcp-remote https://mcp.linear.app/sse - ! Needs authentication'
    ].join('\n')
    expect(parseClaudeMcpList(output)).toEqual([
      { name: 'claude.ai Claude Docs', status: '✓ Connected' },
      { name: 'prometheus-app-mcp-server', status: '✓ Connected' },
      { name: 'linear', status: '! Needs authentication' }
    ])
  })

  it('derives Claude permission rules from server names', () => {
    expect(claudeServerRule('prometheus-app-mcp-server')).toBe('mcp__prometheus-app-mcp-server')
    expect(claudeServerRule('claude.ai Claude Docs')).toBe('mcp__claude_ai_Claude_Docs')
  })
})

describe('Codex exec events', () => {
  it('yields agent messages and finishes on turn.completed', async () => {
    await expect(collect(toChunks(events(CODEX_OK), createCodexParser(), 'Codex'))).resolves.toBe('OK')
  })

  it('separates several agent messages in one turn', async () => {
    const two = [CODEX_OK[2], { ...CODEX_OK[2], item: { type: 'agent_message', text: 'Second' } }, CODEX_OK[3]]
    await expect(collect(toChunks(events(two), createCodexParser(), 'Codex'))).resolves.toBe('OK\n\nSecond')
  })

  it('ignores non-fatal error items and unwraps the turn.failed message', async () => {
    await expect(collect(toChunks(events(CODEX_BAD_MODEL), createCodexParser(), 'Codex'))).rejects.toThrow(
      "The 'bogus-model-x' model is not supported when using Codex with a ChatGPT account."
    )
  })

  it('treats a stream without turn.completed as an unfinished answer', async () => {
    await expect(collect(toChunks(events(CODEX_OK.slice(0, 3)), createCodexParser(), 'Codex'))).rejects.toThrow(
      'exited before finishing'
    )
  })
})

const HISTORY: ChatMessage[] = [
  { role: 'system', content: 'Be brief.' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What is in these?' },
      { type: 'image', mimeType: 'image/png', data: 'aW1n' },
      { type: 'file', mimeType: 'application/pdf', data: 'cGRm', fileName: 'spec.pdf' }
    ]
  },
  { role: 'assistant', content: 'A chart and a spec.' },
  { role: 'user', content: 'Which is longer?' }
]

describe('prompt building', () => {
  it('sends Claude the role-labelled history with earlier attachments as one user message', () => {
    const line = claudeInput(HISTORY)
    expect(line.endsWith('\n')).toBe(true)
    const { type, message } = JSON.parse(line)
    expect(type).toBe('user')
    expect(message.role).toBe('user')
    expect(message.content.map((b: { type: string }) => b.type)).toEqual(['text', 'text', 'image', 'document', 'text', 'text'])
    expect(message.content[0].text).toBe('System:\nBe brief.')
    expect(message.content[1].text).toBe('User:\nWhat is in these?')
    expect(message.content[5].text).toBe('User:\nWhich is longer?')
  })

  it('gives Codex a text transcript and notes omitted documents', () => {
    expect(codexPrompt(HISTORY)).toBe(
      [
        'System:\nBe brief.',
        'User:\nWhat is in these?\n[Attachment "spec.pdf" omitted — Codex does not support document input]',
        'Assistant:\nA chart and a spec.',
        'User:\nWhich is longer?'
      ].join('\n\n')
    )
  })
})

describe('CLI providers', () => {
  const tool = { name: 'srv__t', description: 'd', inputSchema: {} }

  it('reject MCP tools before starting a process', async () => {
    for (const provider of [new ClaudeCliProvider(), new CodexCliProvider()]) {
      const stream = provider.streamChat(HISTORY, 'm', '/nonexistent', { tools: [tool] })
      await expect(stream[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(ToolsUnsupportedError)
    }
  })
})

// End-to-end through spawn with stand-in CLIs on PATH: proves the env is
// scrubbed, non-JSON lines are skipped, and images reach codex as files
describe('CLI providers with stand-in binaries', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
  })

  function fakeBin(name: string, script: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'elrond-fake-'))
    writeFileSync(join(dir, name), `#!/bin/sh\n${script}\n`)
    chmodSync(join(dir, name), 0o755)
    return `${dir}:/usr/bin:/bin`
  }

  it('runs claude without API-key variables and skips non-JSON output', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak'
    const path = fakeBin(
      'claude',
      [
        'cat > /dev/null',
        'echo "warming up"',
        `echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"key=['"$ANTHROPIC_API_KEY"']"}}}'`,
        `echo '{"type":"result","subtype":"success","is_error":false,"result":""}'`
      ].join('\n')
    )
    await expect(collect(new ClaudeCliProvider().streamChat(HISTORY, 'sonnet', path))).resolves.toBe('key=[]')
  })

  it('surfaces stderr when the CLI exits non-zero without an error event', async () => {
    const path = fakeBin('claude', 'cat > /dev/null\necho "not logged in" >&2\nexit 1')
    await expect(collect(new ClaudeCliProvider().streamChat(HISTORY, 'sonnet', path))).rejects.toThrow('not logged in')
  })

  it('records the plan usage claude reports during a run', async () => {
    const path = fakeBin(
      'claude',
      [
        'cat > /dev/null',
        `echo '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.42,"resetsAt":1792278000}}}}'`,
        `echo '{"type":"result","subtype":"success","is_error":false,"result":""}'`
      ].join('\n')
    )
    await collect(new ClaudeCliProvider().streamChat(HISTORY, 'sonnet', path))
    expect(getClaudeUsage()?.windows).toEqual([{ label: '5h', usedPercent: 42, resetsAt: 1792278000_000 }])
  })

  it('reads codex limits over the app-server protocol', async () => {
    // Answers initialize, then the rate-limit read, like codex app-server
    const path = fakeBin(
      'codex',
      [
        'while read -r line; do',
        '  case "$line" in',
        `    *'"id":1'*) echo '{"id":1,"result":{}}' ;;`,
        `    *'account/rateLimits/read'*) echo '{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":10,"windowDurationMins":10080,"resetsAt":1792656037},"secondary":null}}}' ;;`,
        '  esac',
        'done'
      ].join('\n')
    )
    const usage = await readCodexUsage(path)
    expect(usage?.windows).toEqual([{ label: 'Weekly', usedPercent: 10, resetsAt: 1792656037_000 }])
  })

  it('resolves null when codex cannot report limits', async () => {
    await expect(readCodexUsage(fakeBin('codex', 'exit 1'))).resolves.toBeNull()
  })

  // A stand-in that records its argv and environment, then finishes cleanly
  function recordingBin(name: string, done: string, extra = ''): { path: string; args: () => string[]; env: () => string } {
    const dir = mkdtempSync(join(tmpdir(), 'elrond-rec-'))
    const path = fakeBin(
      name,
      [extra, 'cat > /dev/null', `printf '%s\\n' "$@" > ${dir}/args`, `env > ${dir}/env`, `echo '${done}'`].join('\n')
    )
    return {
      path,
      args: () => readFileSync(join(dir, 'args'), 'utf8').trimEnd().split('\n'),
      env: () => readFileSync(join(dir, 'env'), 'utf8')
    }
  }
  const CLAUDE_DONE = '{"type":"result","subtype":"success","is_error":false,"result":""}'

  it('runs claude isolated unless the user opted into CLI MCP servers', async () => {
    const bin = recordingBin('claude', CLAUDE_DONE)
    await collect(new ClaudeCliProvider(() => ['srv-a']).streamChat(HISTORY, 'sonnet', bin.path, { toolsAllowed: false }))
    expect(bin.args()).toContain('--safe-mode')
    expect(bin.args()).not.toContain('--allowedTools')
  })

  it('gives claude only the opted-in servers, pre-approved, with hooks and CLAUDE.md off', async () => {
    const bin = recordingBin('claude', CLAUDE_DONE)
    const provider = new ClaudeCliProvider(() => ['srv-a', 'claude.ai Docs'])
    // Elrond's own tools are ignored rather than rejected when CLI servers stand in
    await collect(provider.streamChat(HISTORY, 'sonnet', bin.path, { toolsAllowed: true, tools: [{ name: 't', description: '', inputSchema: {} }] }))
    const args = bin.args()
    expect(args).not.toContain('--safe-mode')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__srv-a,mcp__claude_ai_Docs')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk')
    expect(args[args.indexOf('--settings') + 1]).toBe('{"disableAllHooks":true}')
    expect(bin.env()).toContain('CLAUDE_CODE_DISABLE_CLAUDE_MDS=1')
  })

  it('switches off every codex server the user did not pick', async () => {
    const list = `[ "$1" = "--disable" ] && [ "$5" = "mcp" ] && { echo '[{"name":"keep","enabled":true},{"name":"drop","enabled":true}]'; exit 0; }`
    const bin = recordingBin('codex', '{"type":"turn.completed"}', list)
    await collect(new CodexCliProvider(() => ['keep']).streamChat(HISTORY, 'gpt-5.6-sol', bin.path, { toolsAllowed: true }))
    const args = bin.args()
    expect(args).not.toContain('--ignore-user-config')
    expect(args).toContain('mcp_servers.drop.enabled=false')
    expect(args).not.toContain('mcp_servers.keep.enabled=false')
    expect(args).toContain('notify=[]')
    expect(args).toContain('model_provider="openai"')
  })

  it('drops codex MCP servers when an unselected name cannot be switched off', async () => {
    const list = `[ "$5" = "mcp" ] && { echo '[{"name":"keep","enabled":true},{"name":"a.b","enabled":true}]'; exit 0; }`
    const bin = recordingBin('codex', '{"type":"turn.completed"}', list)
    await collect(new CodexCliProvider(() => ['keep']).streamChat(HISTORY, 'gpt-5.6-sol', bin.path, { toolsAllowed: true }))
    expect(bin.args()).toContain('--ignore-user-config')
    expect(bin.args().some((a) => a.startsWith('mcp_servers.'))).toBe(false)
  })

  it('fails closed when codex cannot list its servers', async () => {
    const list = `[ "$5" = "mcp" ] && exit 1`
    const bin = recordingBin('codex', '{"type":"turn.completed"}', list)
    await collect(new CodexCliProvider(() => ['keep']).streamChat(HISTORY, 'gpt-5.6-sol', bin.path, { toolsAllowed: true }))
    expect(bin.args()).toContain('--ignore-user-config')
    expect(bin.args().some((a) => a.startsWith('mcp_servers.'))).toBe(false)
  })

  it('re-checks a single Claude MCP server', async () => {
    // Mirrors `claude mcp get <name>` output
    const path = fakeBin(
      'claude',
      `[ "$3" = "rds" ] && { printf 'rds:\\n  Scope: User config\\n  Status: ✘ Failed to connect\\n'; exit 0; }\necho "No MCP server found with name: $3" >&2; exit 1`
    )
    await expect(checkCliMcpServer('anthropic', 'rds', path)).resolves.toEqual({ name: 'rds', status: '✘ Failed to connect' })
    await expect(checkCliMcpServer('anthropic', 'gone', path)).resolves.toEqual({ name: 'gone', status: 'not found' })
  })

  it('shows Codex servers that still need an OAuth login', async () => {
    const path = fakeBin(
      'codex',
      `echo '[{"name":"linear","enabled":true,"auth_status":"not_logged_in"},{"name":"prom","enabled":true,"auth_status":"unsupported"}]'`
    )
    await expect(listCliMcpServers('openai', path)).resolves.toEqual([
      { name: 'linear', status: '! Needs authentication' },
      { name: 'prom', status: '' }
    ])
    await expect(checkCliMcpServer('openai', 'linear', path)).resolves.toEqual({ name: 'linear', status: '! Needs authentication' })
  })

  it('passes images to codex as files and removes them afterwards', async () => {
    // Echo back the -i path and the bytes it points to
    const path = fakeBin(
      'codex',
      [
        'cat > /dev/null',
        'img=""; while [ $# -gt 0 ]; do [ "$1" = "-i" ] && img="$2"; shift; done',
        `echo "{\\"type\\":\\"item.completed\\",\\"item\\":{\\"type\\":\\"agent_message\\",\\"text\\":\\"$img|$(cat "$img")\\"}}"`,
        `echo '{"type":"turn.completed"}'`
      ].join('\n')
    )
    const text = await collect(new CodexCliProvider().streamChat(HISTORY, 'gpt-5.6-sol', path))
    const [file, bytes] = text.split('|')
    expect(file).toMatch(/\.png$/)
    expect(bytes).toBe('img')
    expect(() => readFileSync(file)).toThrow()
  })
})

describe('plan usage parsing', () => {
  it('labels windows by length', () => {
    expect(windowLabel(300)).toBe('5h')
    expect(windowLabel(10080)).toBe('Weekly')
    expect(windowLabel(1440)).toBe('1d')
    expect(windowLabel(null)).toBe('Limit')
  })

  it('converts Claude utilization fractions and reset seconds', () => {
    // Recorded from a claude 2.1.295 rate_limit_event
    const info = {
      unifiedWindows: {
        five_hour: { utilization: 0.01, resetsAt: 1792278000 },
        seven_day: { utilization: 0.05, resetsAt: 1792782000 }
      }
    }
    expect(parseClaudeUsage(info, 123)).toEqual({
      checkedAt: 123,
      windows: [
        { label: '5h', usedPercent: 1, resetsAt: 1792278000_000 },
        { label: 'Weekly', usedPercent: 5, resetsAt: 1792782000_000 }
      ]
    })
    expect(parseClaudeUsage({}, 123)).toBeNull()
  })

  it('reads whichever Codex windows the plan has', () => {
    const result = {
      rateLimits: {
        primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1792278000 },
        secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: null }
      }
    }
    expect(parseCodexUsage(result, 1)?.windows).toEqual([
      { label: '5h', usedPercent: 37, resetsAt: 1792278000_000 },
      { label: 'Weekly', usedPercent: 12, resetsAt: null }
    ])
    expect(parseCodexUsage({ rateLimits: { primary: null, secondary: null } }, 1)).toBeNull()
    expect(parseCodexUsage(undefined, 1)).toBeNull()
  })
})
