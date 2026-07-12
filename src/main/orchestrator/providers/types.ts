export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string } // data = base64, no data: prefix
  | { type: 'file'; mimeType: string; data: string; fileName: string }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
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

export interface StreamChunk {
  delta: string
}

export interface AgentProvider {
  readonly name: string
  // credential is the API key for cloud providers; for keyless local
  // providers (ollama) it carries the server base URL instead
  streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk>
}
