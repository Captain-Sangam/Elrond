import { describe, expect, it } from 'vitest'
import {
  ToolsUnsupportedError,
  type AgentProvider,
  type ChatMessage,
  type StreamChunk,
  type ToolDefinition
} from './providers/types'
import {
  buildNamespacedTools,
  runToolLoop,
  type McpBridge,
  type ToolLifecycleEvent,
  type ToolLoopParams
} from './toolLoop'

// Mirrors of the module-private constants in toolLoop.ts
const MAX_TOOL_ITERATIONS = 8
const MAX_CALLS_PER_ITERATION = 16
const TOOL_RESULT_MAX_CHARS = 16_000

const text = (delta: string): StreamChunk => ({ type: 'text', delta })
const toolCall = (id: string, name: string, argsJson = ''): StreamChunk => ({
  type: 'tool_call',
  call: { id, name, argsJson }
})

// A script step is either a chunk to yield or a side effect (e.g. abort) to run
// between yields
type ScriptStep = StreamChunk | (() => void)

interface RecordedStream {
  messages: ChatMessage[]
  tools: ToolDefinition[] | undefined
}

// Fake provider: each streamChat call consumes the next script entry (the last
// entry repeats). An Error entry is thrown when the stream is first pulled.
function makeProvider(scripts: (ScriptStep[] | Error)[]): {
  provider: AgentProvider
  streams: RecordedStream[]
} {
  const streams: RecordedStream[] = []
  let n = 0
  const provider: AgentProvider = {
    name: 'fake',
    async *streamChat(messages, _model, _credential, options) {
      streams.push({ messages: [...messages], tools: options?.tools })
      const script = scripts[Math.min(n, scripts.length - 1)]
      n++
      if (script instanceof Error) throw script
      for (const step of script) {
        if (typeof step === 'function') step()
        else yield step
      }
    }
  }
  return { provider, streams }
}

interface McpCall {
  serverId: string
  toolName: string
  args: Record<string, unknown>
}

function makeMcp(
  impl?: (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<{ content?: unknown; isError?: boolean }>
): { mcp: McpBridge; calls: McpCall[] } {
  const calls: McpCall[] = []
  const mcp: McpBridge = {
    async callTool(serverId, toolName, args) {
      calls.push({ serverId, toolName, args })
      if (impl) return impl(serverId, toolName, args)
      return { content: `ok:${toolName}` }
    }
  }
  return { mcp, calls }
}

// One Linear server exposing a single `search` tool → namespaced `linear__search`
function linearTools(): ReturnType<typeof buildNamespacedTools> {
  return buildNamespacedTools([
    {
      serverId: 's1',
      serverName: 'Linear',
      tool: { name: 'search', description: 'Search issues', inputSchema: { type: 'object' } }
    }
  ])
}

interface Harness {
  textDeltas: string[]
  notices: string[]
  toolEvents: ToolLifecycleEvent[]
  iterationSnapshots: ChatMessage[][]
}

function makeHarness(): Harness {
  return { textDeltas: [], notices: [], toolEvents: [], iterationSnapshots: [] }
}

// NOTE: toolLoop.ts keeps a module-level cache of `provider:model` keys that
// rejected tools. Every test below uses a unique model name so the cache never
// leaks between tests.
function loopParams(
  h: Harness,
  overrides: Partial<ToolLoopParams> & Pick<ToolLoopParams, 'provider' | 'model'>
): ToolLoopParams {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    credential: 'key',
    signal: new AbortController().signal,
    onText: (d) => h.textDeltas.push(d),
    onTool: (e) => h.toolEvents.push(e),
    onNotice: (m) => h.notices.push(m),
    onIterationStart: (msgs) => h.iterationSnapshots.push([...msgs]),
    ...overrides
  }
}

describe('buildNamespacedTools', () => {
  it('namespaces tools as serverslug__toolname and indexes them back to the server', () => {
    const { tools, toolIndex } = linearTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('linear__search')
    expect(toolIndex.get('linear__search')).toEqual({
      serverId: 's1',
      serverName: 'Linear',
      toolName: 'search'
    })
  })

  it('slugifies spaced/punctuated server names and sanitizes tool names per character', () => {
    const { tools, toolIndex } = buildNamespacedTools([
      {
        serverId: 's1',
        serverName: 'My GitHub (Work)',
        tool: { name: 'get issue!', inputSchema: {} }
      },
      // A server name with no alphanumerics falls back to the 'server' slug
      { serverId: 's2', serverName: '!!!', tool: { name: 'ping', inputSchema: {} } }
    ])
    expect(tools.map((t) => t.name)).toEqual(['my_github_work__get_issue_', 'server__ping'])
    expect(toolIndex.get('my_github_work__get_issue_')?.toolName).toBe('get issue!')
  })

  it('truncates namespaced names to 64 characters', () => {
    const { tools, toolIndex } = buildNamespacedTools([
      {
        serverId: 's1',
        serverName: 'a'.repeat(40),
        tool: { name: 'b'.repeat(40), inputSchema: {} }
      }
    ])
    const expected = `${'a'.repeat(40)}__${'b'.repeat(40)}`.slice(0, 64)
    expect(tools[0].name).toBe(expected)
    expect(tools[0].name).toHaveLength(64)
    expect(toolIndex.get(expected)?.toolName).toBe('b'.repeat(40))
  })

  it('disambiguates name collisions between servers with a hash suffix', () => {
    const { tools, toolIndex } = buildNamespacedTools([
      { serverId: 's1', serverName: 'Linear!', tool: { name: 'search', inputSchema: {} } },
      { serverId: 's2', serverName: 'linear', tool: { name: 'search', inputSchema: {} } }
    ])
    expect(tools).toHaveLength(2)
    expect(tools[0].name).toBe('linear__search')
    expect(tools[1].name).toMatch(/^linear__search_[a-z0-9]{2}$/)
    expect(toolIndex.get(tools[0].name)?.serverId).toBe('s1')
    expect(toolIndex.get(tools[1].name)?.serverId).toBe('s2')
  })

  it('registers an identical duplicate under a hashed name and skips further copies', () => {
    const entry = {
      serverId: 's1',
      serverName: 'Linear',
      tool: { name: 'search', inputSchema: {} }
    }
    const { tools, toolIndex } = buildNamespacedTools([entry, entry, entry])
    // Current behavior: the second identical registration is NOT skipped — it
    // gets the hash-suffixed name; only the third (whose hashed name now
    // collides too) is dropped.
    expect(tools).toHaveLength(2)
    expect(tools[0].name).toBe('linear__search')
    expect(tools[1].name).toMatch(/^linear__search_[a-z0-9]{2}$/)
    for (const t of tools) {
      expect(toolIndex.get(t.name)).toEqual({
        serverId: 's1',
        serverName: 'Linear',
        toolName: 'search'
      })
    }
  })

  it('prefixes descriptions with the workspace-scoping notice', () => {
    const { tools } = buildNamespacedTools([
      {
        serverId: 's1',
        serverName: 'Linear',
        tool: { name: 'search', description: 'Search issues', inputSchema: {} }
      },
      { serverId: 's1', serverName: 'Linear', tool: { name: 'bare', inputSchema: {} } }
    ])
    expect(tools[0].description).toBe(
      '[Linear workspace data only — not general knowledge] Search issues'
    )
    // Missing description → prefix with empty suffix (trailing space preserved)
    expect(tools[1].description).toBe('[Linear workspace data only — not general knowledge] ')
  })
})

describe('runToolLoop', () => {
  it('forwards text in a single iteration when no tools are configured', async () => {
    const h = makeHarness()
    const { provider, streams } = makeProvider([[text('Hello '), text('world')]])
    const result = await runToolLoop(loopParams(h, { provider, model: 'm-plain' }))
    expect(result.content).toBe('Hello world')
    expect(h.textDeltas).toEqual(['Hello ', 'world'])
    expect(streams).toHaveLength(1)
    expect(streams[0].tools).toBeUndefined()
    expect(h.iterationSnapshots).toHaveLength(0)
  })

  it('passes tools to the stream but stays single-iteration when the model makes no calls', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp } = makeMcp()
    const { provider, streams } = makeProvider([[text('No tools needed.')]])
    const result = await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-no-calls',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(result.content).toBe('No tools needed.')
    expect(streams).toHaveLength(1)
    expect(streams[0].tools).toBe(nt.tools)
  })

  it('executes a tool call, appends assistant + tool messages, and re-streams', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp, calls } = makeMcp(async () => ({ content: 'found 3 issues' }))
    const { provider, streams } = makeProvider([
      [text('Checking. '), toolCall('c1', 'linear__search', '{"q":"foo"}')],
      [text('Done.')]
    ])
    const result = await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-happy',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )

    expect(result.content).toBe('Checking. \n\nDone.')
    expect(h.textDeltas).toEqual(['Checking. ', '\n\n', 'Done.'])
    expect(streams).toHaveLength(2)

    // The re-stream sees the grown history: user, assistant (with the call), tool result
    expect(streams[1].messages).toHaveLength(3)
    expect(streams[1].messages[1]).toEqual({
      role: 'assistant',
      content: 'Checking. ',
      toolCalls: [{ id: 'c1', name: 'linear__search', argsJson: '{"q":"foo"}' }]
    })
    expect(streams[1].messages[2]).toEqual({
      role: 'tool',
      content: 'found 3 issues',
      toolCallId: 'c1',
      toolName: 'linear__search',
      isError: false
    })

    // Dispatch used the index entry, not the namespaced name
    expect(calls).toEqual([{ serverId: 's1', toolName: 'search', args: { q: 'foo' } }])

    // Lifecycle: running with args preview, then ok with result preview + duration
    expect(h.toolEvents).toEqual([
      {
        callId: 'c1',
        toolName: 'linear__search',
        serverName: 'Linear',
        status: 'running',
        argsPreview: '{"q":"foo"}'
      },
      {
        callId: 'c1',
        toolName: 'linear__search',
        serverName: 'Linear',
        status: 'ok',
        resultPreview: 'found 3 issues',
        errorMessage: undefined,
        durationMs: expect.any(Number)
      }
    ])

    // onIterationStart fired once, before the re-stream, with the grown list
    expect(h.iterationSnapshots).toHaveLength(1)
    expect(h.iterationSnapshots[0]).toHaveLength(3)
  })

  it('answers an unknown tool with an error result and no MCP dispatch', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp, calls } = makeMcp()
    const { provider, streams } = makeProvider([
      [toolCall('c1', 'nope__missing', '{}')],
      [text('recovered')]
    ])
    const result = await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-unknown-tool',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(result.content).toBe('recovered')
    expect(calls).toHaveLength(0)
    expect(h.toolEvents).toHaveLength(0)
    expect(streams[1].messages[2]).toEqual({
      role: 'tool',
      content: 'Unknown tool "nope__missing"',
      toolCallId: 'c1',
      toolName: 'nope__missing',
      isError: true
    })
  })

  it('answers invalid JSON arguments with an error result and no MCP dispatch', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp, calls } = makeMcp()
    const { provider, streams } = makeProvider([
      [toolCall('c1', 'linear__search', '{not json')],
      [text('recovered')]
    ])
    await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-bad-json',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(calls).toHaveLength(0)
    expect(h.toolEvents).toHaveLength(0)
    expect(streams[1].messages[2]).toEqual({
      role: 'tool',
      content: 'Invalid JSON in tool arguments',
      toolCallId: 'c1',
      toolName: 'linear__search',
      isError: true
    })
  })

  it('caps tool calls per iteration and errors the overflow calls', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp, calls } = makeMcp()
    const seventeen = Array.from({ length: MAX_CALLS_PER_ITERATION + 1 }, (_, i) =>
      toolCall(`c${i}`, 'linear__search')
    )
    const { provider, streams } = makeProvider([seventeen, [text('done')]])
    await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-call-cap',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(calls).toHaveLength(MAX_CALLS_PER_ITERATION)
    // Empty argsJson dispatches with an empty args object
    expect(calls[0].args).toEqual({})
    // user + assistant + 17 tool results; the 17th is the cap error
    expect(streams[1].messages).toHaveLength(2 + MAX_CALLS_PER_ITERATION + 1)
    expect(streams[1].messages.at(-1)).toEqual({
      role: 'tool',
      content: `Too many tool calls in one turn (max ${MAX_CALLS_PER_ITERATION})`,
      toolCallId: `c${MAX_CALLS_PER_ITERATION}`,
      toolName: 'linear__search',
      isError: true
    })
  })

  it('truncates oversized tool results at the max-chars constant', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp } = makeMcp(async () => ({ content: 'x'.repeat(TOOL_RESULT_MAX_CHARS + 50) }))
    const { provider, streams } = makeProvider([
      [toolCall('c1', 'linear__search')],
      [text('done')]
    ])
    await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-truncate',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(streams[1].messages[2].content).toBe(
      `${'x'.repeat(TOOL_RESULT_MAX_CHARS)}\n…[truncated 50 chars]`
    )
  })

  it('flattens content-block arrays, omitting non-text blocks', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp } = makeMcp(async () => ({
      content: [
        { type: 'text', text: 'alpha' },
        { type: 'image', data: 'zzz' },
        { type: 'text', text: 'beta' }
      ]
    }))
    const { provider, streams } = makeProvider([
      [toolCall('c1', 'linear__search')],
      [text('done')]
    ])
    await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-blocks',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(streams[1].messages[2].content).toBe('alpha\n[non-text content omitted]\nbeta')
  })

  it('marks isError tool results and reports them via the error lifecycle event', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp } = makeMcp(async () => ({ content: 'boom', isError: true }))
    const { provider, streams } = makeProvider([
      [toolCall('c1', 'linear__search')],
      [text('done')]
    ])
    await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-tool-error',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(streams[1].messages[2]).toMatchObject({ role: 'tool', content: 'boom', isError: true })
    expect(h.toolEvents[1]).toEqual({
      callId: 'c1',
      toolName: 'linear__search',
      serverName: 'Linear',
      status: 'error',
      resultPreview: undefined,
      errorMessage: 'boom',
      durationMs: expect.any(Number)
    })
  })

  it('converts a thrown MCP error into an error result and lifecycle event', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp } = makeMcp(async () => {
      throw new Error('server exploded')
    })
    const { provider, streams } = makeProvider([
      [toolCall('c1', 'linear__search')],
      [text('done')]
    ])
    await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-mcp-throw',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(streams[1].messages[2]).toMatchObject({
      role: 'tool',
      content: 'server exploded',
      isError: true
    })
    expect(h.toolEvents[1]).toMatchObject({ status: 'error', errorMessage: 'server exploded' })
  })

  it('retries without tools on cacheable ToolsUnsupportedError and caches per provider:model', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp } = makeMcp()
    const { provider, streams } = makeProvider([
      new ToolsUnsupportedError('m-cache-hit'),
      [text('No tools answer')]
    ])
    const result = await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-cache-hit',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(result.content).toBe('No tools answer')
    expect(streams).toHaveLength(2)
    expect(streams[0].tools).toBe(nt.tools)
    expect(streams[1].tools).toBeUndefined()
    expect(h.notices).toEqual([
      'm-cache-hit does not support tools — answering without MCP tools.'
    ])

    // Second run for the same provider:model skips tools from the start
    const h2 = makeHarness()
    const second = makeProvider([[text('cached run')]])
    const result2 = await runToolLoop(
      loopParams(h2, {
        provider: second.provider,
        model: 'm-cache-hit',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(result2.content).toBe('cached run')
    expect(second.streams).toHaveLength(1)
    expect(second.streams[0].tools).toBeUndefined()
    expect(h2.notices).toEqual([])
  })

  it('does not cache non-cacheable ToolsUnsupportedError rejections', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp } = makeMcp()
    const first = makeProvider([
      new ToolsUnsupportedError('m-no-cache', 'schema rejected', false),
      [text('fallback answer')]
    ])
    const result = await runToolLoop(
      loopParams(h, {
        provider: first.provider,
        model: 'm-no-cache',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(result.content).toBe('fallback answer')
    expect(h.notices).toEqual(['schema rejected — answering without MCP tools.'])

    // Same model tries tools again on the next run
    const second = makeProvider([[text('with tools')]])
    await runToolLoop(
      loopParams(makeHarness(), {
        provider: second.provider,
        model: 'm-no-cache',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(second.streams[0].tools).toBe(nt.tools)
  })

  it('returns partial content when aborted mid-stream', async () => {
    const h = makeHarness()
    const controller = new AbortController()
    const { provider, streams } = makeProvider([
      [text('partial'), () => controller.abort(), text('more')]
    ])
    const result = await runToolLoop(
      loopParams(h, { provider, model: 'm-abort-stream', signal: controller.signal })
    )
    expect(result.content).toBe('partial')
    expect(h.textDeltas).toEqual(['partial'])
    expect(streams).toHaveLength(1)
  })

  it('cancels remaining tool calls and stops looping when aborted during execution', async () => {
    const h = makeHarness()
    const controller = new AbortController()
    const nt = linearTools()
    const { mcp, calls } = makeMcp(async () => {
      controller.abort()
      throw new Error('fetch aborted')
    })
    const { provider, streams } = makeProvider([
      [text('Working. '), toolCall('c1', 'linear__search'), toolCall('c2', 'linear__search')]
    ])
    const result = await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-abort-exec',
        signal: controller.signal,
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(result.content).toBe('Working. ')
    // Only the first call reached MCP; the second was pre-cancelled
    expect(calls).toHaveLength(1)
    // The abort suppresses the ok/error lifecycle events — only 'running' fired
    expect(h.toolEvents).toEqual([
      expect.objectContaining({ callId: 'c1', status: 'running' })
    ])
    // No re-stream after abort
    expect(streams).toHaveLength(1)
    expect(h.iterationSnapshots).toHaveLength(0)
  })

  it('streams the final allowed iteration without tools once the cap is reached', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp, calls } = makeMcp()
    const scripts: (ScriptStep[] | Error)[] = Array.from(
      { length: MAX_TOOL_ITERATIONS },
      (_, i) => [toolCall(`c${i}`, 'linear__search')]
    )
    scripts.push([text('Final answer')])
    const { provider, streams } = makeProvider(scripts)
    const result = await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-iteration-cap',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(result.content).toBe('Final answer')
    expect(streams).toHaveLength(MAX_TOOL_ITERATIONS + 1)
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      expect(streams[i].tools).toBe(nt.tools)
    }
    expect(streams[MAX_TOOL_ITERATIONS].tools).toBeUndefined()
    expect(calls).toHaveLength(MAX_TOOL_ITERATIONS)
    // onIterationStart fired before each of the 8 re-streams with a growing list
    expect(h.iterationSnapshots).toHaveLength(MAX_TOOL_ITERATIONS)
    expect(h.iterationSnapshots[0]).toHaveLength(3)
    expect(h.iterationSnapshots.at(-1)).toHaveLength(1 + 2 * MAX_TOOL_ITERATIONS)
  })

  it('omits the iteration separator when the tool-calling iteration produced no text', async () => {
    const h = makeHarness()
    const nt = linearTools()
    const { mcp } = makeMcp()
    const { provider } = makeProvider([[toolCall('c1', 'linear__search')], [text('Answer.')]])
    const result = await runToolLoop(
      loopParams(h, {
        provider,
        model: 'm-no-separator',
        tools: nt.tools,
        toolIndex: nt.toolIndex,
        mcp
      })
    )
    expect(result.content).toBe('Answer.')
    expect(h.textDeltas).toEqual(['Answer.'])
  })
})
