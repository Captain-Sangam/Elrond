export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string } // data = base64, no data: prefix
  | { type: 'file'; mimeType: string; data: string; fileName: string }

// A tool exposed to the model. Names are namespaced per MCP server
// (`serverslug__toolname`) and already sanitized to the strictest provider
// naming rules (^[a-zA-Z0-9_-]{1,64}$).
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

// One tool invocation emitted by the model. `id` pairs the call with its
// result message; Gemini has no native ids so the provider synthesizes one.
export interface ToolCall {
  id: string
  name: string
  argsJson: string // raw JSON string; '' means no arguments
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  // assistant only: tool calls this turn made (serialized natively per provider)
  toolCalls?: ToolCall[]
  // tool only: which call this result answers
  toolCallId?: string
  // tool only: Gemini pairs results by function name, not id
  toolName?: string
  // tool only: the call failed; providers surface this natively where supported
  isError?: boolean
}

// Flattens content to plain text for provider slots that only accept strings
// (system prompts, assistant history)
export function contentToText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  // Emitted once per call, after its arguments JSON has fully streamed
  | { type: 'tool_call'; call: ToolCall }

export interface StreamChatOptions {
  signal?: AbortSignal
  tools?: ToolDefinition[]
}

// Thrown when a model rejects the tools parameter outright (e.g. Ollama models
// without a tool template) — the caller retries without tools.
export class ToolsUnsupportedError extends Error {
  constructor(model: string) {
    super(`Model ${model} does not support tools`)
    this.name = 'ToolsUnsupportedError'
  }
}

export interface AgentProvider {
  readonly name: string
  // credential is the API key for cloud providers; for keyless local
  // providers (ollama) it carries the server base URL instead
  streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    options?: StreamChatOptions
  ): AsyncIterable<StreamChunk>
}
