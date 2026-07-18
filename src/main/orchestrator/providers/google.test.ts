import type { FunctionDeclarationsTool } from '@google/generative-ai'
import { describe, expect, it } from 'vitest'
import { sanitizeForGemini, toGoogleContents, toGoogleTools } from './google'
import type { ChatMessage, ToolDefinition } from './types'

describe('sanitizeForGemini', () => {
  it('returns undefined for non-object input', () => {
    expect(sanitizeForGemini(null)).toBeUndefined()
    expect(sanitizeForGemini(undefined)).toBeUndefined()
    expect(sanitizeForGemini('string')).toBeUndefined()
    expect(sanitizeForGemini(42)).toBeUndefined()
    expect(sanitizeForGemini(true)).toBeUndefined()
    expect(sanitizeForGemini([{ type: 'string' }])).toBeUndefined()
  })

  it('keeps only the Gemini keyword subset and strips the rest', () => {
    expect(
      sanitizeForGemini({
        type: 'string',
        description: 'a name',
        enum: ['a', 'b'],
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        minLength: 3,
        default: 'a',
        title: 'Name'
      })
    ).toEqual({ type: 'STRING', description: 'a name', enum: ['a', 'b'] })
  })

  it('uppercases the type', () => {
    expect(sanitizeForGemini({ type: 'integer' })).toEqual({ type: 'INTEGER' })
    expect(sanitizeForGemini({ type: 'boolean' })).toEqual({ type: 'BOOLEAN' })
  })

  it('defaults a missing type to STRING', () => {
    expect(sanitizeForGemini({ description: 'anything' })).toEqual({
      description: 'anything',
      type: 'STRING'
    })
    expect(sanitizeForGemini({})).toEqual({ type: 'STRING' })
  })

  it('degrades a union type array to its first non-null member plus nullable', () => {
    expect(sanitizeForGemini({ type: ['string', 'null'] })).toEqual({
      type: 'STRING',
      nullable: true
    })
    expect(sanitizeForGemini({ type: ['null', 'integer'] })).toEqual({
      type: 'INTEGER',
      nullable: true
    })
  })

  it('falls back to STRING for a type array of only null', () => {
    expect(sanitizeForGemini({ type: ['null'] })).toEqual({ type: 'STRING', nullable: true })
  })

  it('flattens anyOf to the first non-null variant and marks it nullable', () => {
    expect(
      sanitizeForGemini({
        anyOf: [{ type: 'null' }, { type: 'integer' }],
        description: 'parent description'
      })
    ).toEqual({ type: 'INTEGER', description: 'parent description', nullable: true })
  })

  it('prefers the variant description over the union parent description', () => {
    expect(
      sanitizeForGemini({
        anyOf: [{ type: 'string', description: 'variant description' }],
        description: 'parent description'
      })
    ).toEqual({ type: 'STRING', description: 'variant description' })
  })

  it('flattens oneOf and allOf through the same path', () => {
    expect(sanitizeForGemini({ oneOf: [{ type: 'null' }, { type: 'boolean' }] })).toEqual({
      type: 'BOOLEAN',
      nullable: true
    })
    expect(sanitizeForGemini({ allOf: [{ type: 'number' }] })).toEqual({ type: 'NUMBER' })
  })

  it('returns undefined when the chosen union variant is unrepresentable', () => {
    expect(sanitizeForGemini({ anyOf: [{ type: 'object' }] })).toBeUndefined()
  })

  it('ignores anyOf when an explicit type is present', () => {
    expect(sanitizeForGemini({ type: 'string', anyOf: [{ type: 'integer' }] })).toEqual({
      type: 'STRING'
    })
  })

  it('prunes empty OBJECT schemas to undefined', () => {
    expect(sanitizeForGemini({ type: 'object' })).toBeUndefined()
    expect(sanitizeForGemini({ type: 'object', properties: {} })).toBeUndefined()
  })

  it('prunes empty OBJECT schemas at any nesting depth, cascading upward', () => {
    // inner object has no properties → dropped; that empties the outer object → also dropped
    expect(
      sanitizeForGemini({
        type: 'object',
        properties: { inner: { type: 'object', properties: {} } }
      })
    ).toBeUndefined()
  })

  it('drops unrepresentable properties but keeps their siblings', () => {
    expect(
      sanitizeForGemini({
        type: 'object',
        properties: {
          good: { type: 'string' },
          freeform: { type: 'object' }
        }
      })
    ).toEqual({ type: 'OBJECT', properties: { good: { type: 'STRING' } } })
  })

  it('sanitizes array item schemas recursively', () => {
    expect(sanitizeForGemini({ type: 'array', items: { type: 'string' } })).toEqual({
      type: 'ARRAY',
      items: { type: 'STRING' }
    })
    expect(
      sanitizeForGemini({
        type: 'array',
        items: { type: 'object', properties: { a: { type: 'integer' } } }
      })
    ).toEqual({ type: 'ARRAY', items: { type: 'OBJECT', properties: { a: { type: 'INTEGER' } } } })
  })

  it('drops arrays whose items are unrepresentable', () => {
    expect(sanitizeForGemini({ type: 'array', items: { type: 'object' } })).toBeUndefined()
  })

  it('whitelists format values per type', () => {
    // STRING accepts only date-time and enum
    expect(sanitizeForGemini({ type: 'string', format: 'date-time' })).toEqual({
      type: 'STRING',
      format: 'date-time'
    })
    expect(sanitizeForGemini({ type: 'string', format: 'enum' })).toEqual({
      type: 'STRING',
      format: 'enum'
    })
    expect(sanitizeForGemini({ type: 'string', format: 'uri' })).toEqual({ type: 'STRING' })
    expect(sanitizeForGemini({ type: 'string', format: 'uuid' })).toEqual({ type: 'STRING' })

    // NUMBER accepts only float and double
    expect(sanitizeForGemini({ type: 'number', format: 'double' })).toEqual({
      type: 'NUMBER',
      format: 'double'
    })
    expect(sanitizeForGemini({ type: 'number', format: 'date-time' })).toEqual({ type: 'NUMBER' })

    // INTEGER accepts only int32 and int64
    expect(sanitizeForGemini({ type: 'integer', format: 'int64' })).toEqual({
      type: 'INTEGER',
      format: 'int64'
    })
    expect(sanitizeForGemini({ type: 'integer', format: 'float' })).toEqual({ type: 'INTEGER' })
  })

  it('filters required down to surviving properties', () => {
    expect(
      sanitizeForGemini({
        type: 'object',
        properties: {
          keep: { type: 'string' },
          dropped: { type: 'object' }
        },
        required: ['keep', 'dropped']
      })
    ).toEqual({
      type: 'OBJECT',
      properties: { keep: { type: 'STRING' } },
      required: ['keep']
    })
  })

  it('removes required entirely when no listed property survives', () => {
    const result = sanitizeForGemini({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['gone']
    })
    expect(result).toEqual({ type: 'OBJECT', properties: { a: { type: 'STRING' } } })
    expect(result).not.toHaveProperty('required')
  })
})

describe('toGoogleContents', () => {
  it('skips system messages and maps assistant to model', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' }
    ]
    expect(toGoogleContents(messages)).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'hi there' }] }
    ])
  })

  it('converts multipart content to text and inlineData parts', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see attached' },
          { type: 'image', mimeType: 'image/png', data: 'IMGDATA' },
          { type: 'file', mimeType: 'application/pdf', data: 'PDFDATA', fileName: 'doc.pdf' }
        ]
      }
    ]
    expect(toGoogleContents(messages)).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'see attached' },
          { inlineData: { mimeType: 'image/png', data: 'IMGDATA' } },
          { inlineData: { mimeType: 'application/pdf', data: 'PDFDATA' } }
        ]
      }
    ])
  })

  it('wraps successful tool results as { result } and errors as { error }', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'it worked', toolName: 'search', toolCallId: 'call_1' }
    ]
    expect(toGoogleContents(messages)).toEqual([
      {
        role: 'function',
        parts: [{ functionResponse: { name: 'search', response: { result: 'it worked' } } }]
      }
    ])

    const errorMessages: ChatMessage[] = [
      { role: 'tool', content: 'it failed', toolName: 'search', toolCallId: 'call_1', isError: true }
    ]
    expect(toGoogleContents(errorMessages)).toEqual([
      {
        role: 'function',
        parts: [{ functionResponse: { name: 'search', response: { error: 'it failed' } } }]
      }
    ])
  })

  it('falls back to an empty function name when toolName is missing', () => {
    const contents = toGoogleContents([{ role: 'tool', content: 'ok', toolCallId: 'call_1' }])
    expect(contents[0].parts[0].functionResponse?.name).toBe('')
  })

  it('folds consecutive tool results into one function content', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'ra', toolName: 'a', toolCallId: 'call_1' },
      { role: 'tool', content: 'rb', toolName: 'b', toolCallId: 'call_2' }
    ]
    const contents = toGoogleContents(messages)
    expect(contents).toHaveLength(1)
    expect(contents[0].role).toBe('function')
    expect(contents[0].parts).toHaveLength(2)
  })

  it('does not fold tool results separated by another message', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'ra', toolName: 'a', toolCallId: 'call_1' },
      { role: 'user', content: 'and?' },
      { role: 'tool', content: 'rb', toolName: 'b', toolCallId: 'call_2' }
    ]
    const contents = toGoogleContents(messages)
    expect(contents.map((c) => c.role)).toEqual(['function', 'user', 'function'])
  })

  it('converts assistant tool calls to functionCall parts with a leading text part', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'checking',
        toolCalls: [
          { id: 'call_1', name: 'search', argsJson: '{"q":"cats"}' },
          { id: 'call_2', name: 'noargs', argsJson: '' }
        ]
      }
    ]
    expect(toGoogleContents(messages)).toEqual([
      {
        role: 'model',
        parts: [
          { text: 'checking' },
          { functionCall: { name: 'search', args: { q: 'cats' } } },
          // empty argsJson parses to an empty args object
          { functionCall: { name: 'noargs', args: {} } }
        ]
      }
    ])
  })

  it('omits the text part when the tool-calling assistant message has no text', () => {
    const contents = toGoogleContents([
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'search', argsJson: '{}' }] }
    ])
    expect(contents[0].parts).toEqual([{ functionCall: { name: 'search', args: {} } }])
  })

  it('passes thoughtSignature through on functionCall parts, omitting it otherwise', () => {
    const contents = toGoogleContents([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'signed', argsJson: '{}', thoughtSignature: 'sig-abc' },
          { id: 'call_2', name: 'unsigned', argsJson: '{}' }
        ]
      }
    ])
    const [signed, unsigned] = contents[0].parts
    expect(signed).toHaveProperty('thoughtSignature', 'sig-abc')
    expect(unsigned).not.toHaveProperty('thoughtSignature')
  })
})

describe('toGoogleTools', () => {
  it('produces a single Tool wrapping all function declarations', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'gh__search',
        description: 'Search GitHub',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } }
      }
    ]
    expect(toGoogleTools(tools)).toEqual([
      {
        functionDeclarations: [
          {
            name: 'gh__search',
            description: 'Search GitHub',
            parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } } }
          }
        ]
      }
    ])
  })

  it('leaves parameters undefined for zero-arg tools', () => {
    const tools: ToolDefinition[] = [
      { name: 'ping', description: 'No arguments', inputSchema: { type: 'object', properties: {} } }
    ]
    const [tool] = toGoogleTools(tools) as FunctionDeclarationsTool[]
    expect(tool.functionDeclarations?.[0].parameters).toBeUndefined()
  })
})
