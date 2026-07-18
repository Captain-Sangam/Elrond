import type OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { streamOpenAIChunks, toOpenAIMessage, toOpenAIToolMessage, toOpenAITools } from './openai'
import type { ChatMessage, StreamChunk, ToolDefinition } from './types'

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk
type Delta = Chunk['choices'][number]['delta']

function chunk(delta: Delta): Chunk {
  return {
    id: 'chunk_1',
    choices: [{ index: 0, delta, finish_reason: null }],
    created: 0,
    model: 'test-model',
    object: 'chat.completion.chunk'
  }
}

async function* toStream(chunks: Chunk[]): AsyncGenerator<Chunk> {
  for (const c of chunks) yield c
}

async function collect(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const item of source) out.push(item)
  return out
}

describe('toOpenAIToolMessage', () => {
  it('serializes a tool result message', () => {
    const m: ChatMessage = { role: 'tool', content: 'search results', toolCallId: 'call_1' }
    expect(toOpenAIToolMessage(m)).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'search results'
    })
  })

  it('prefixes error results with ERROR:', () => {
    const m: ChatMessage = { role: 'tool', content: 'boom', toolCallId: 'call_1', isError: true }
    expect(toOpenAIToolMessage(m)).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'ERROR: boom'
    })
  })

  it('falls back to an empty tool_call_id', () => {
    const m: ChatMessage = { role: 'tool', content: 'ok' }
    expect(toOpenAIToolMessage(m)).toMatchObject({ tool_call_id: '' })
  })

  it('serializes an assistant message with tool calls', () => {
    const m: ChatMessage = {
      role: 'assistant',
      content: 'let me look that up',
      toolCalls: [
        { id: 'call_1', name: 'search', argsJson: '{"q":"cats"}' },
        { id: 'call_2', name: 'noargs', argsJson: '' }
      ]
    }
    expect(toOpenAIToolMessage(m)).toEqual({
      role: 'assistant',
      content: 'let me look that up',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"cats"}' } },
        // empty argsJson falls back to '{}'
        { id: 'call_2', type: 'function', function: { name: 'noargs', arguments: '{}' } }
      ]
    })
  })

  it('uses null content for a tool-calling assistant message with no text', () => {
    const m: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'search', argsJson: '{}' }]
    }
    expect(toOpenAIToolMessage(m)).toMatchObject({ role: 'assistant', content: null })
  })

  it('returns null for roles the caller maps itself', () => {
    expect(toOpenAIToolMessage({ role: 'user', content: 'hi' })).toBeNull()
    expect(toOpenAIToolMessage({ role: 'system', content: 'be nice' })).toBeNull()
    expect(toOpenAIToolMessage({ role: 'assistant', content: 'plain answer' })).toBeNull()
    // an empty toolCalls array does not count as a tool-calling message
    expect(toOpenAIToolMessage({ role: 'assistant', content: 'x', toolCalls: [] })).toBeNull()
  })
})

describe('toOpenAITools', () => {
  it('wraps tool definitions as function tools', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'gh__search',
        description: 'Search GitHub',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } }
      }
    ]
    expect(toOpenAITools(tools)).toEqual([
      {
        type: 'function',
        function: {
          name: 'gh__search',
          description: 'Search GitHub',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      }
    ])
  })
})

describe('toOpenAIMessage', () => {
  it('converts multimodal user content to content parts', () => {
    const m: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', mimeType: 'image/png', data: 'AAA' },
        { type: 'file', mimeType: 'application/pdf', data: 'BBB', fileName: 'report.pdf' }
      ]
    }
    expect(toOpenAIMessage(m)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        { type: 'file', file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,BBB' } }
      ]
    })
  })

  it('passes string user content through', () => {
    expect(toOpenAIMessage({ role: 'user', content: 'hi' })).toEqual({ role: 'user', content: 'hi' })
  })

  it('flattens assistant multipart content to text', () => {
    const m: ChatMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'image', mimeType: 'image/png', data: 'AAA' },
        { type: 'text', text: 'line two' }
      ]
    }
    expect(toOpenAIMessage(m)).toEqual({ role: 'assistant', content: 'line one\nline two' })
  })

  it('flattens system multipart content to text', () => {
    const m: ChatMessage = { role: 'system', content: [{ type: 'text', text: 'be concise' }] }
    expect(toOpenAIMessage(m)).toEqual({ role: 'system', content: 'be concise' })
  })

  it('delegates tool-protocol messages to toOpenAIToolMessage', () => {
    const m: ChatMessage = { role: 'tool', content: 'done', toolCallId: 'call_9' }
    expect(toOpenAIMessage(m)).toEqual({ role: 'tool', tool_call_id: 'call_9', content: 'done' })
  })
})

describe('streamOpenAIChunks', () => {
  it('emits plain text deltas as text events', async () => {
    const events = await collect(
      streamOpenAIChunks(toStream([chunk({ content: 'Hel' }), chunk({ content: 'lo' })]))
    )
    expect(events).toEqual([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' }
    ])
  })

  it('emits nothing for empty deltas or chunks without choices', async () => {
    const noChoices: Chunk = {
      id: 'chunk_2',
      choices: [],
      created: 0,
      model: 'test-model',
      object: 'chat.completion.chunk'
    }
    const events = await collect(streamOpenAIChunks(toStream([chunk({}), noChoices])))
    expect(events).toEqual([])
  })

  it('assembles a tool call whose id/name arrive on the first fragment only', async () => {
    const events = await collect(
      streamOpenAIChunks(
        toStream([
          chunk({
            tool_calls: [
              { index: 0, id: 'call_a', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }
            ]
          }),
          chunk({ content: 'thinking...' }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: '"cats"}' } }] })
        ])
      )
    )
    // text streams live; the assembled call is only emitted after the stream ends
    expect(events).toEqual([
      { type: 'text', delta: 'thinking...' },
      { type: 'tool_call', call: { id: 'call_a', name: 'lookup', argsJson: '{"q":"cats"}' } }
    ])
  })

  it('assembles interleaved tool calls by index and emits them in index order', async () => {
    const events = await collect(
      streamOpenAIChunks(
        toStream([
          // index 1 starts first — output must still be sorted by index
          chunk({
            tool_calls: [
              { index: 1, id: 'call_b', type: 'function', function: { name: 'beta', arguments: '{"b":' } }
            ]
          }),
          chunk({
            tool_calls: [
              { index: 0, id: 'call_a', type: 'function', function: { name: 'alpha', arguments: '{"a":1' } }
            ]
          }),
          chunk({
            tool_calls: [
              { index: 1, function: { arguments: '2}' } },
              { index: 0, function: { arguments: '}' } }
            ]
          })
        ])
      )
    )
    expect(events).toEqual([
      { type: 'tool_call', call: { id: 'call_a', name: 'alpha', argsJson: '{"a":1}' } },
      { type: 'tool_call', call: { id: 'call_b', name: 'beta', argsJson: '{"b":2}' } }
    ])
  })

  it('emits a fragment with never-seen id/name as empty strings', async () => {
    const events = await collect(
      streamOpenAIChunks(toStream([chunk({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] })]))
    )
    expect(events).toEqual([{ type: 'tool_call', call: { id: '', name: '', argsJson: '{}' } }])
  })
})
