import OpenAI from 'openai'
import type { AgentProvider, ChatMessage, StreamChunk } from './types'

export class OpenAIProvider implements AgentProvider {
  readonly name = 'openai'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const client = new OpenAI({ apiKey })
    const stream = await client.chat.completions.create(
      {
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true
      },
      { signal }
    )

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        yield { delta }
      }
    }
  }
}

const OPENAI_CHAT_PREFIXES = ['gpt-4', 'gpt-3.5', 'o1', 'o3', 'o4', 'chatgpt-']
const OPENAI_EXCLUDE = ['instruct', 'vision', 'realtime', 'audio', 'search']

export async function listOpenAIModels(apiKey: string): Promise<string[]> {
  const client = new OpenAI({ apiKey })
  const response = await client.models.list()
  return response.data
    .filter((m) => {
      const id = m.id.toLowerCase()
      const hasPrefix = OPENAI_CHAT_PREFIXES.some((p) => id.startsWith(p))
      const excluded = OPENAI_EXCLUDE.some((e) => id.includes(e))
      return hasPrefix && !excluded
    })
    .map((m) => m.id)
    .sort()
}

export async function testOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const client = new OpenAI({ apiKey })
    await client.models.list()
    return true
  } catch {
    return false
  }
}
