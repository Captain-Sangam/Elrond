import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ClaudeCliProvider,
  CodexCliProvider,
  claudeInput,
  codexPrompt,
  createCodexParser,
  parseClaudeEvent,
  toChunks,
  type CliEvent
} from './cli'
import { ToolsUnsupportedError, type ChatMessage, type StreamChunk } from './types'

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

async function collect(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) if (chunk.type === 'text') text += chunk.delta
  return text
}

describe('Claude stream-json events', () => {
  it('streams text deltas once, ignoring the repeated final text', async () => {
    await expect(collect(toChunks(events(CLAUDE_OK), parseClaudeEvent, 'Claude Code'))).resolves.toBe('OK')
  })

  it('throws the CLI message on an error result', async () => {
    await expect(collect(toChunks(events([CLAUDE_BAD_MODEL]), parseClaudeEvent, 'Claude Code'))).rejects.toThrow(
      'issue with the selected model'
    )
  })

  it('refuses to run on an API key instead of the subscription', () => {
    expect(() => parseClaudeEvent({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' })).toThrow(
      'not your subscription'
    )
  })

  it('treats a stream without a result as an unfinished answer', async () => {
    await expect(collect(toChunks(events(CLAUDE_OK.slice(0, 4)), parseClaudeEvent, 'Claude Code'))).rejects.toThrow(
      'exited before finishing'
    )
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
