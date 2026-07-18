import { describe, expect, it } from 'vitest'
import { contentToText, ToolsUnsupportedError, type ContentPart } from './types'

describe('contentToText', () => {
  it('returns string content unchanged', () => {
    expect(contentToText('hello world')).toBe('hello world')
    expect(contentToText('')).toBe('')
  })

  it('joins text parts with newlines', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
      { type: 'text', text: 'third' }
    ]
    expect(contentToText(content)).toBe('first\nsecond\nthird')
  })

  it('filters out non-text parts', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'before' },
      { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
      { type: 'file', mimeType: 'application/pdf', data: 'JVBERi0=', fileName: 'doc.pdf' },
      { type: 'text', text: 'after' }
    ]
    expect(contentToText(content)).toBe('before\nafter')
  })

  it('returns empty string for an empty array', () => {
    expect(contentToText([])).toBe('')
  })

  it('returns empty string when only non-text parts are present', () => {
    const content: ContentPart[] = [{ type: 'image', mimeType: 'image/png', data: 'AAA' }]
    expect(contentToText(content)).toBe('')
  })
})

describe('ToolsUnsupportedError', () => {
  it('builds a default message from the model name', () => {
    const err = new ToolsUnsupportedError('llama3')
    expect(err.message).toBe('llama3 does not support tools')
  })

  it('is an Error named ToolsUnsupportedError', () => {
    const err = new ToolsUnsupportedError('llama3')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ToolsUnsupportedError')
  })

  it('defaults cacheable to true', () => {
    expect(new ToolsUnsupportedError('llama3').cacheable).toBe(true)
    expect(new ToolsUnsupportedError('llama3', 'custom message').cacheable).toBe(true)
  })

  it('uses an explicit message and cacheable flag when given', () => {
    const err = new ToolsUnsupportedError('gemini-2.5-pro', 'rejected the tool definitions', false)
    expect(err.message).toBe('rejected the tool definitions')
    expect(err.cacheable).toBe(false)
  })
})
