import OpenAI from 'openai'
import {
  contentToText,
  type AgentProvider,
  type ChatMessage,
  type ContentPart,
  type StreamChatOptions,
  type StreamChunk,
  type ToolDefinition
} from './types'

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

export function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }))
}

// Serializes the tool-protocol roles shared by OpenAI and its compatibles
// (Ollama). Returns null for roles the caller maps itself.
export function toOpenAIToolMessage(
  m: ChatMessage
): OpenAI.Chat.Completions.ChatCompletionMessageParam | null {
  if (m.role === 'tool') {
    const text = contentToText(m.content)
    return {
      role: 'tool',
      tool_call_id: m.toolCallId ?? '',
      // No native error flag — an explicit prefix tells the model it failed
      content: m.isError ? `ERROR: ${text}` : text
    }
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: contentToText(m.content) || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.argsJson || '{}' }
      }))
    }
  }
  return null
}

// Assembles streamed tool-call fragments and yields our chunk union. Fragments
// are keyed by index — only the first fragment of a call carries id/name.
export async function* streamOpenAIChunks(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
): AsyncIterable<StreamChunk> {
  const pending = new Map<number, { id: string; name: string; args: string }>()

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    if (delta?.content) {
      yield { type: 'text', delta: delta.content }
    }
    for (const fragment of delta?.tool_calls ?? []) {
      const entry = pending.get(fragment.index) ?? { id: '', name: '', args: '' }
      if (fragment.id) entry.id = fragment.id
      if (fragment.function?.name) entry.name = fragment.function.name
      if (fragment.function?.arguments) entry.args += fragment.function.arguments
      pending.set(fragment.index, entry)
    }
  }

  for (const [, call] of [...pending.entries()].sort(([a], [b]) => a - b)) {
    yield { type: 'tool_call', call: { id: call.id, name: call.name, argsJson: call.args } }
  }
}

// Only user messages accept multimodal parts; other roles are flattened to text
export function toOpenAIMessage(m: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  const toolMessage = toOpenAIToolMessage(m)
  if (toolMessage) return toolMessage
  if (m.role === 'user' && typeof m.content !== 'string') {
    return { role: 'user', content: m.content.map(toOpenAIContentPart) }
  }
  return { role: m.role as 'system' | 'user' | 'assistant', content: contentToText(m.content) }
}

export class OpenAIProvider implements AgentProvider {
  readonly name = 'openai'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    options?: StreamChatOptions
  ): AsyncIterable<StreamChunk> {
    const client = new OpenAI({ apiKey: credential })
    const stream = await client.chat.completions.create(
      {
        model,
        messages: messages.map(toOpenAIMessage),
        tools: options?.tools?.length ? toOpenAITools(options.tools) : undefined,
        stream: true
      },
      { signal: options?.signal }
    )

    yield* streamOpenAIChunks(stream)
  }
}

const OPENAI_CHAT_PREFIXES = ['gpt-5', 'gpt-4', 'gpt-3.5', 'o1', 'o3', 'o4', 'chatgpt-']
// Excludes models that don't speak the chat-completions API: media models
// (image/audio/tts/transcribe), and responses-API-only variants (codex, -pro)
const OPENAI_EXCLUDE = ['instruct', 'vision', 'realtime', 'audio', 'search', 'image', 'codex', '-pro', 'transcribe', 'tts']

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
