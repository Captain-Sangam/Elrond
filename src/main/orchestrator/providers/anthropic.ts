import Anthropic from '@anthropic-ai/sdk'
import {
  contentToText,
  type AgentProvider,
  type ChatMessage,
  type ContentPart,
  type StreamChatOptions,
  type StreamChunk,
  type ToolDefinition
} from './types'

export function toAnthropicBlock(part: ContentPart): Anthropic.Messages.ContentBlockParam {
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

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema
  }))
}

export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.Messages.MessageParam[] {
  const result: Anthropic.Messages.MessageParam[] = []
  let lastWasTool = false

  for (const m of messages) {
    if (m.role === 'system') continue

    if (m.role === 'tool') {
      const block: Anthropic.Messages.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: contentToText(m.content),
        is_error: m.isError || undefined
      }
      // Consecutive results fold into one user message — splitting them
      // breaks the API's tool_use/tool_result pairing
      if (lastWasTool) {
        ;(result[result.length - 1].content as Anthropic.Messages.ContentBlockParam[]).push(block)
      } else {
        result.push({ role: 'user', content: [block] })
      }
      lastWasTool = true
      continue
    }
    lastWasTool = false

    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: Anthropic.Messages.ContentBlockParam[] = []
      const text = contentToText(m.content)
      if (text) blocks.push({ type: 'text', text })
      for (const call of m.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: JSON.parse(call.argsJson || '{}')
        })
      }
      result.push({ role: 'assistant', content: blocks })
      continue
    }

    result.push({
      role: m.role as 'user' | 'assistant',
      content: toAnthropicContent(m.content)
    })
  }

  return result
}

export class AnthropicProvider implements AgentProvider {
  readonly name = 'anthropic'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    options?: StreamChatOptions
  ): AsyncIterable<StreamChunk> {
    const client = new Anthropic({ apiKey: credential })

    const systemMessage = messages.find((m) => m.role === 'system')

    const stream = client.messages.stream(
      {
        model,
        max_tokens: 8192,
        system: systemMessage ? contentToText(systemMessage.content) : undefined,
        messages: toAnthropicMessages(messages),
        tools: options?.tools?.length ? toAnthropicTools(options.tools) : undefined
      },
      { signal: options?.signal }
    )

    // tool_use blocks stream their arguments as input_json_delta fragments,
    // keyed by content-block index; a call is complete at content_block_stop
    const pending = new Map<number, { id: string; name: string; json: string }>()

    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        pending.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          json: ''
        })
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', delta: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          const call = pending.get(event.index)
          if (call) call.json += event.delta.partial_json
        }
      } else if (event.type === 'content_block_stop') {
        const call = pending.get(event.index)
        if (call) {
          pending.delete(event.index)
          yield { type: 'tool_call', call: { id: call.id, name: call.name, argsJson: call.json } }
        }
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
