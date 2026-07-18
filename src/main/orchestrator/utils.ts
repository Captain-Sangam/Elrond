// Pure helpers for the orchestrator — no electron/db/keychain imports so they
// stay unit-testable in isolation.
import type { ChatMessage, ContentPart } from './providers/types'

export function cleanErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error'
  const raw = err.message

  // Anthropic: "404 {"type":"error","error":{"type":"not_found_error","message":"model: ..."}}"
  try {
    const jsonStart = raw.indexOf('{')
    if (jsonStart !== -1) {
      const parsed = JSON.parse(raw.slice(jsonStart))
      if (parsed?.error?.message) return parsed.error.message
    }
  } catch {
    // not JSON, fall through
  }

  // Google: "[GoogleGenerativeAI Error]: Error fetching from ... [429 Too Many Requests] ..."
  const googleMatch = raw.match(/\[GoogleGenerativeAI Error\]:\s*(.+?)(?:\s*https?:\/\/\S+)?$/s)
  if (googleMatch) {
    const inner = googleMatch[1]
    // Google retires model aliases regularly — make that case actionable
    const retiredMatch = inner.match(/models\/(\S+) is not found/)
    if (retiredMatch) {
      return `Model "${retiredMatch[1]}" is no longer available — pick a new Google model in Settings`
    }
    const statusMatch = inner.match(/\[(\d+ .+?)\]/)
    if (statusMatch) return statusMatch[1]
    return inner.slice(0, 120)
  }

  // Truncate very long messages
  if (raw.length > 150) return raw.slice(0, 150) + '...'
  return raw
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Rough flat estimate per image/PDF part — base64 length wildly overestimates
export const ATTACHMENT_TOKEN_ESTIMATE = 1500

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content)
    } else {
      for (const part of m.content) {
        total += part.type === 'text' ? estimateTokens(part.text) : ATTACHMENT_TOKEN_ESTIMATE
      }
    }
  }
  return total
}

export function attachmentToPart(fileName: string, mimeType: string, data: string): ContentPart {
  return mimeType.startsWith('image/')
    ? { type: 'image', mimeType, data }
    : { type: 'file', mimeType, data, fileName }
}
