import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclaration,
  type Part,
  type Tool
} from '@google/generative-ai'
import { v4 as uuidv4 } from 'uuid'
import {
  contentToText,
  type AgentProvider,
  type ChatMessage,
  type ContentPart,
  type StreamChatOptions,
  type StreamChunk,
  type ToolDefinition
} from './types'

function toGoogleParts(content: string | ContentPart[]): Part[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.map((part) =>
    part.type === 'text'
      ? { text: part.text }
      : { inlineData: { mimeType: part.mimeType, data: part.data } }
  )
}

const GEMINI_SCHEMA_KEYS = ['type', 'description', 'properties', 'required', 'items', 'enum', 'format', 'nullable'] as const

// Gemini rejects JSON-Schema keywords it doesn't know ($schema,
// additionalProperties, anyOf, ...) — keep only its OpenAPI-style subset.
// Lossy by design: union keywords degrade to their first variant.
function sanitizeForGemini(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined
  const src = schema as Record<string, unknown>

  const variants = (src.anyOf ?? src.oneOf ?? src.allOf) as unknown[] | undefined
  if (!src.type && Array.isArray(variants) && variants.length) {
    return sanitizeForGemini(variants[0])
  }

  const out: Record<string, unknown> = {}
  for (const key of GEMINI_SCHEMA_KEYS) {
    if (!(key in src)) continue
    let value = src[key]
    if (key === 'type') {
      // JSON-Schema union types (['string','null']) → first non-null + nullable
      if (Array.isArray(value)) {
        if (value.includes('null')) out.nullable = true
        value = value.find((v) => v !== 'null') ?? 'string'
      }
      value = String(value).toUpperCase()
    } else if (key === 'properties') {
      const props: Record<string, unknown> = {}
      for (const [name, prop] of Object.entries(value as Record<string, unknown>)) {
        const sanitized = sanitizeForGemini(prop)
        if (sanitized) props[name] = sanitized
      }
      value = props
    } else if (key === 'items') {
      value = sanitizeForGemini(value) ?? { type: 'STRING' }
    }
    out[key] = value
  }
  if (!out.type) out.type = 'STRING'
  // required may only reference declared properties
  if (Array.isArray(out.required)) {
    const props = (out.properties ?? {}) as Record<string, unknown>
    out.required = (out.required as string[]).filter((r) => r in props)
    if ((out.required as string[]).length === 0) delete out.required
  }
  return out
}

function toGoogleTools(tools: ToolDefinition[]): Tool[] {
  const declarations = tools.map((t) => {
    const parameters = sanitizeForGemini(t.inputSchema)
    const properties = parameters?.properties as Record<string, unknown> | undefined
    // Gemini 400s on OBJECT parameters with no properties — omit them instead
    const usable = parameters && properties && Object.keys(properties).length > 0
    return {
      name: t.name,
      description: t.description,
      parameters: usable ? parameters : undefined
    } as FunctionDeclaration
  })
  return [{ functionDeclarations: declarations }]
}

function toGoogleContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = []
  let lastWasTool = false

  for (const m of messages) {
    if (m.role === 'system') continue

    if (m.role === 'tool') {
      const part: Part = {
        functionResponse: {
          name: m.toolName ?? '',
          // Gemini requires an object response — wrap the text
          response: m.isError
            ? { error: contentToText(m.content) }
            : { result: contentToText(m.content) }
        }
      }
      // Consecutive results fold into one function turn, mirroring the
      // model turn that made the calls
      if (lastWasTool) {
        contents[contents.length - 1].parts.push(part)
      } else {
        contents.push({ role: 'function', parts: [part] })
      }
      lastWasTool = true
      continue
    }
    lastWasTool = false

    if (m.role === 'assistant' && m.toolCalls?.length) {
      const parts: Part[] = []
      const text = contentToText(m.content)
      if (text) parts.push({ text })
      for (const call of m.toolCalls) {
        parts.push({ functionCall: { name: call.name, args: JSON.parse(call.argsJson || '{}') } })
      }
      contents.push({ role: 'model', parts })
      continue
    }

    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toGoogleParts(m.content)
    })
  }

  return contents
}

export class GoogleProvider implements AgentProvider {
  readonly name = 'google'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    options?: StreamChatOptions
  ): AsyncIterable<StreamChunk> {
    const genAI = new GoogleGenerativeAI(credential)

    const systemMessage = messages.find((m) => m.role === 'system')
    const genModel = genAI.getGenerativeModel({
      model,
      systemInstruction: systemMessage
        ? { role: 'user', parts: [{ text: contentToText(systemMessage.content) }] }
        : undefined,
      tools: options?.tools?.length ? toGoogleTools(options.tools) : undefined
    })

    const result = await genModel.generateContentStream(
      { contents: toGoogleContents(messages) },
      { signal: options?.signal }
    )

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        yield { type: 'text', delta: text }
      }
      for (const fc of chunk.functionCalls() ?? []) {
        // Gemini has no call ids — synthesize one to pair the result locally
        yield {
          type: 'tool_call',
          call: { id: `call_${uuidv4()}`, name: fc.name, argsJson: JSON.stringify(fc.args ?? {}) }
        }
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
    // Rolling alias — hardcoded model ids here go stale when Google retires them
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' })
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
