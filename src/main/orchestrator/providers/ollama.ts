import OpenAI from 'openai'
import { contentToText, type AgentProvider, type ChatMessage, type ContentPart, type StreamChunk } from './types'

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  return (trimmed || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '')
}

function toOllamaContentPart(part: ContentPart): OpenAI.Chat.Completions.ChatCompletionContentPart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'image':
      return { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
    case 'file':
      // Ollama has no document input — note the omission so the model can say so
      return { type: 'text', text: `[Attachment "${part.fileName}" omitted — Ollama does not support document input]` }
  }
}

function toOllamaMessage(m: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === 'user' && typeof m.content !== 'string') {
    return { role: 'user', content: m.content.map(toOllamaContentPart) }
  }
  return { role: m.role, content: contentToText(m.content) }
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const cause = (err as { cause?: unknown }).cause
  const causeMessage = cause instanceof Error ? cause.message : ''
  return /ECONNREFUSED|fetch failed|Connection error/i.test(`${err.message} ${causeMessage}`)
}

// Talks to Ollama through its OpenAI-compatible /v1 endpoint, so streaming and
// abort behave exactly like the OpenAI provider. The credential slot carries
// the server base URL instead of an API key.
export class OllamaProvider implements AgentProvider {
  readonly name = 'ollama'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const baseUrl = normalizeBaseUrl(credential)
    const client = new OpenAI({ apiKey: 'ollama', baseURL: `${baseUrl}/v1` })

    let stream: Awaited<ReturnType<typeof client.chat.completions.create>>
    try {
      stream = await client.chat.completions.create(
        {
          model,
          messages: messages.map(toOllamaMessage),
          stream: true
        },
        { signal }
      )
    } catch (err) {
      if (isConnectionError(err)) {
        throw new Error(`Cannot reach Ollama at ${baseUrl} — is the Ollama server running?`)
      }
      throw err
    }

    for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        yield { delta }
      }
    }
  }
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/tags`, {
    signal: AbortSignal.timeout(3000)
  })
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
  const json = (await res.json()) as { models?: { name: string }[] }
  return (json.models ?? []).map((m) => m.name).sort()
}

export async function testOllamaConnection(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok) return false
    const json = (await res.json()) as { models?: unknown }
    return Array.isArray(json.models)
  } catch {
    return false
  }
}
