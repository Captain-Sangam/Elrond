import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './providers/types'
import {
  ATTACHMENT_TOKEN_ESTIMATE,
  attachmentToPart,
  cleanErrorMessage,
  estimateMessagesTokens,
  estimateTokens
} from './utils'

describe('cleanErrorMessage', () => {
  it('returns "Unknown error" for non-Error input', () => {
    expect(cleanErrorMessage('boom')).toBe('Unknown error')
    expect(cleanErrorMessage(undefined)).toBe('Unknown error')
    expect(cleanErrorMessage({ message: 'nope' })).toBe('Unknown error')
  })

  it('extracts the inner message from Anthropic-style embedded JSON errors', () => {
    const err = new Error(
      '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-9 not found"}}'
    )
    expect(cleanErrorMessage(err)).toBe('model: claude-9 not found')
  })

  it('turns a Google retired-model error into an actionable message', () => {
    const err = new Error(
      '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent: [404 Not Found] models/gemini-pro is not found for API version v1beta, or is not supported for generateContent.'
    )
    expect(cleanErrorMessage(err)).toBe(
      'Model "gemini-pro" is no longer available — pick a new Google model in Settings'
    )
  })

  it('extracts the bracketed HTTP status from Google errors', () => {
    const err = new Error(
      '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse: [429 Too Many Requests] Resource has been exhausted (e.g. check quota).'
    )
    expect(cleanErrorMessage(err)).toBe('429 Too Many Requests')
  })

  it('strips a trailing URL and passes through short Google errors without status or retired model', () => {
    expect(cleanErrorMessage(new Error('[GoogleGenerativeAI Error]: fetch failed https://example.com/x'))).toBe(
      'fetch failed'
    )
    expect(cleanErrorMessage(new Error('[GoogleGenerativeAI Error]: something strange happened'))).toBe(
      'something strange happened'
    )
  })

  it('truncates long plain messages at 150 chars with an ellipsis', () => {
    const err = new Error('a'.repeat(200))
    expect(cleanErrorMessage(err)).toBe('a'.repeat(150) + '...')
  })

  it('passes short plain messages through unchanged', () => {
    expect(cleanErrorMessage(new Error('Connection refused'))).toBe('Connection refused')
  })

  it('falls through to passthrough when the embedded JSON is invalid', () => {
    expect(cleanErrorMessage(new Error('Bad thing {not json}'))).toBe('Bad thing {not json}')
  })
})

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('estimateMessagesTokens', () => {
  it('sums estimates over string-content messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'abcd' }, // 1
      { role: 'assistant', content: 'abcde' } // 2
    ]
    expect(estimateMessagesTokens(messages)).toBe(3)
  })

  it('estimates text parts by length and image/file parts at the flat attachment estimate', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'abcdefgh' }, // 2
          { type: 'image', mimeType: 'image/png', data: 'x'.repeat(9999) },
          { type: 'file', mimeType: 'application/pdf', data: 'y'.repeat(9999), fileName: 'a.pdf' }
        ]
      },
      { role: 'assistant', content: 'abcd' } // 1
    ]
    expect(estimateMessagesTokens(messages)).toBe(3 + 2 * ATTACHMENT_TOKEN_ESTIMATE)
  })
})

describe('attachmentToPart', () => {
  it('maps image/* mime types to an image part without a file name', () => {
    expect(attachmentToPart('pic.png', 'image/png', 'AAA=')).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: 'AAA='
    })
  })

  it('maps other mime types to a file part carrying the file name', () => {
    expect(attachmentToPart('doc.pdf', 'application/pdf', 'BBB=')).toEqual({
      type: 'file',
      mimeType: 'application/pdf',
      data: 'BBB=',
      fileName: 'doc.pdf'
    })
  })
})
