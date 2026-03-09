import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AgentProvider, ChatMessage, StreamChunk } from './types'

export class GoogleProvider implements AgentProvider {
  readonly name = 'google'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    _signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const genModel = genAI.getGenerativeModel({ model })

    const systemMessage = messages.find((m) => m.role === 'system')
    const chatMessages = messages.filter((m) => m.role !== 'system')

    const history = chatMessages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

    const lastMessage = chatMessages[chatMessages.length - 1]

    const chat = genModel.startChat({
      history,
      systemInstruction: systemMessage ? { role: 'user', parts: [{ text: systemMessage.content }] } : undefined
    })

    const result = await chat.sendMessageStream(lastMessage.content)

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        yield { delta: text }
      }
    }
  }
}

const GOOGLE_EXCLUDE = ['embedding', 'aqa', 'bisheng', 'tunedModels', '-vision']

export async function listGoogleModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  )
  if (!res.ok) throw new Error(`Google API error: ${res.status}`)
  const data = (await res.json()) as {
    models: { name: string; supportedGenerationMethods?: string[] }[]
  }
  return data.models
    .filter((m) => {
      if (!m.supportedGenerationMethods?.includes('generateContent')) return false
      const id = m.name.replace('models/', '')
      if (!id.startsWith('gemini-')) return false
      if (GOOGLE_EXCLUDE.some((e) => id.includes(e))) return false
      return true
    })
    .map((m) => m.name.replace('models/', ''))
    .sort()
    .reverse()
}

export async function testGoogleKey(apiKey: string): Promise<boolean> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    await model.generateContent('hi')
    return true
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Only treat explicit auth/permission failures as invalid keys
    if (message.includes('API_KEY_INVALID') || message.includes('401') || message.includes('403')) {
      return false
    }
    // Any other error (model not found, quota, etc.) means the key authenticated fine
    return true
  }
}
