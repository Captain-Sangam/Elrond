export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChunk {
  delta: string
}

export interface AgentProvider {
  readonly name: string
  streamChat(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk>
}
