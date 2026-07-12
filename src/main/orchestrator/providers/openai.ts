import OpenAI from 'openai'
import { contentToText, type AgentProvider, type ChatMessage, type ContentPart, type StreamChunk } from './types'

function toOpenAIContentPart(part: ContentPart): OpenAI.Chat.Completions.ChatCompletionContentPart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'image':
      return { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
    case 'file':
      return {
        type: 'file',
        file: { filename: part.fileName, file_data: `data:${part.mimeType};base64,${part.data}` }
      }
  }
}

// Only user messages accept multimodal parts; other roles are flattened to text
function toOpenAIMessage(m: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === 'user' && typeof m.content !== 'string') {
    return { role: 'user', content: m.content.map(toOpenAIContentPart) }
  }
  return { role: m.role, content: contentToText(m.content) }
}

export class OpenAIProvider implements AgentProvider {
  readonly name = 'openai'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const client = new OpenAI({ apiKey: credential })
    const stream = await client.chat.completions.create(
      {
        model,
        messages: messages.map(toOpenAIMessage),
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
