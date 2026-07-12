import Anthropic from '@anthropic-ai/sdk'
import { contentToText, type AgentProvider, type ChatMessage, type ContentPart, type StreamChunk } from './types'

function toAnthropicBlock(part: ContentPart): Anthropic.Messages.ContentBlockParam {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'image':
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.mimeType as Anthropic.Messages.Base64ImageSource['media_type'],
          data: part.data
        }
      }
    case 'file':
      return {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: part.data },
        title: part.fileName
      }
  }
}

function toAnthropicContent(content: string | ContentPart[]): string | Anthropic.Messages.ContentBlockParam[] {
  if (typeof content === 'string') return content
  return content.map(toAnthropicBlock)
}

export class AnthropicProvider implements AgentProvider {
  readonly name = 'anthropic'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const client = new Anthropic({ apiKey: credential })

    const systemMessage = messages.find((m) => m.role === 'system')
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: toAnthropicContent(m.content)
      }))

    const stream = client.messages.stream(
      {
        model,
        max_tokens: 4096,
        system: systemMessage ? contentToText(systemMessage.content) : undefined,
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
