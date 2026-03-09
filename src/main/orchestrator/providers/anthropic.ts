import Anthropic from '@anthropic-ai/sdk'
import type { AgentProvider, ChatMessage, StreamChunk } from './types'

export class AnthropicProvider implements AgentProvider {
  readonly name = 'anthropic'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const client = new Anthropic({ apiKey })

    const systemMessage = messages.find((m) => m.role === 'system')
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))

    const stream = client.messages.stream(
      {
        model,
        max_tokens: 4096,
        system: systemMessage?.content || undefined,
        messages: chatMessages
      },
      { signal }
    )

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { delta: event.delta.text }
      }
    }
  }
}

export async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const client = new Anthropic({ apiKey })
  const response = await client.models.list({ limit: 100 })
  return response.data
    .filter((m) => m.id.startsWith('claude-'))
    .map((m) => m.id)
    .sort()
    .reverse()
}

export async function testAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    const client = new Anthropic({ apiKey })
    await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }]
    })
    return true
  } catch (err: unknown) {
    if (err instanceof Anthropic.AuthenticationError) return false
    if (err instanceof Anthropic.PermissionDeniedError) return false
    // Any other error (model not found, rate limit, etc.) means the key itself is valid
    return true
  }
}
