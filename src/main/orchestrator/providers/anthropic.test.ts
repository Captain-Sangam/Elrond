import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { toAnthropicBlock, toAnthropicMessages } from './anthropic'
import type { ChatMessage } from './types'

describe('toAnthropicMessages', () => {
  it('skips system messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hi' }
    ]
    expect(toAnthropicMessages(messages)).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('passes plain string content through', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' }
    ]
    expect(toAnthropicMessages(messages)).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' }
    ])
  })

  it('converts multipart content to content blocks', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', mimeType: 'image/jpeg', data: 'IMGDATA' }
        ]
      }
    ]
    expect(toAnthropicMessages(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'IMGDATA' } }
        ]
      }
    ])
  })

  it('converts assistant tool calls to tool_use blocks with a leading text block', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'let me check',
        toolCalls: [
          { id: 'call_1', name: 'search', argsJson: '{"q":"cats"}' },
          { id: 'call_2', name: 'noargs', argsJson: '' }
        ]
      }
    ]
    expect(toAnthropicMessages(messages)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'cats' } },
          // empty argsJson parses to an empty input object
          { type: 'tool_use', id: 'call_2', name: 'noargs', input: {} }
        ]
      }
    ])
  })

  it('omits the text block when the tool-calling assistant message has no text', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'search', argsJson: '{}' }] }
    ]
    expect(toAnthropicMessages(messages)).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'search', input: {} }] }
    ])
  })

  it('folds consecutive tool results into a single user message', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'result one', toolCallId: 'call_1' },
      { role: 'tool', content: 'it broke', toolCallId: 'call_2', isError: true }
    ]
    const result = toAnthropicMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')

    const blocks = result[0].content as Anthropic.Messages.ToolResultBlockParam[]
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'tool_result', tool_use_id: 'call_1', content: 'result one' })
    expect(blocks[0].is_error).toBeUndefined()
    expect(blocks[1]).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_2',
      content: 'it broke',
      is_error: true
    })
  })

  it('normalizes isError: false to an absent is_error', () => {
    const result = toAnthropicMessages([
      { role: 'tool', content: 'fine', toolCallId: 'call_1', isError: false }
    ])
    const blocks = result[0].content as Anthropic.Messages.ToolResultBlockParam[]
    expect(blocks[0].is_error).toBeUndefined()
  })

  it('does not fold tool results separated by another message', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'first', toolCallId: 'call_1' },
      { role: 'assistant', content: 'partial answer' },
      { role: 'tool', content: 'second', toolCallId: 'call_2' }
    ]
    const result = toAnthropicMessages(messages)
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect((result[0].content as unknown[]).length).toBe(1)
    expect((result[2].content as unknown[]).length).toBe(1)
  })

  it('falls back to an empty tool_use_id when toolCallId is missing', () => {
    const result = toAnthropicMessages([{ role: 'tool', content: 'ok' }])
    const blocks = result[0].content as Anthropic.Messages.ToolResultBlockParam[]
    expect(blocks[0].tool_use_id).toBe('')
  })

  it('interleaves a full tool round-trip correctly', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'do two things' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'a', argsJson: '{}' },
          { id: 'call_2', name: 'b', argsJson: '{}' }
        ]
      },
      { role: 'tool', content: 'ra', toolCallId: 'call_1' },
      { role: 'tool', content: 'rb', toolCallId: 'call_2' },
      { role: 'assistant', content: 'done' }
    ]
    const result = toAnthropicMessages(messages)
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect((result[2].content as unknown[]).length).toBe(2)
  })
})

describe('toAnthropicBlock', () => {
  it('converts a text part', () => {
    expect(toAnthropicBlock({ type: 'text', text: 'hello' })).toEqual({ type: 'text', text: 'hello' })
  })

  it('converts an image part to a base64 image block', () => {
    expect(toAnthropicBlock({ type: 'image', mimeType: 'image/png', data: 'PNGDATA' })).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'PNGDATA' }
    })
  })

  it('converts a file part to a document block titled with the file name', () => {
    expect(
      toAnthropicBlock({ type: 'file', mimeType: 'application/pdf', data: 'PDFDATA', fileName: 'report.pdf' })
    ).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'PDFDATA' },
      title: 'report.pdf'
    })
  })

  it('pins document media_type to application/pdf regardless of the part mimeType', () => {
    const block = toAnthropicBlock({
      type: 'file',
      mimeType: 'text/plain',
      data: 'TXTDATA',
      fileName: 'notes.txt'
    }) as Anthropic.Messages.DocumentBlockParam
    expect((block.source as Anthropic.Messages.Base64PDFSource).media_type).toBe('application/pdf')
  })
})
