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
  ToolsUnsupportedError,
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
// Lossy by design: unions degrade to their first non-null variant, and
// properties that can't be represented (freeform objects) are dropped
// entirely rather than lied about. Returns undefined for the unrepresentable.
export function sanitizeForGemini(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined
  const src = schema as Record<string, unknown>

  const variants = (src.anyOf ?? src.oneOf ?? src.allOf) as unknown[] | undefined
  if (!src.type && Array.isArray(variants) && variants.length) {
    const isNull = (v: unknown): boolean => (v as Record<string, unknown> | null)?.type === 'null'
    const first = sanitizeForGemini(variants.find((v) => !isNull(v)) ?? variants[0])
    if (!first) return undefined
    // The description usually lives on the union parent, not the variant
    if (src.description && !first.description) first.description = src.description
    if (variants.some(isNull)) first.nullable = true
    return first
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
      const sanitized = sanitizeForGemini(value)
      if (!sanitized) return undefined // array of the unrepresentable — drop it
      value = sanitized
    }
    out[key] = value
  }
  if (!out.type) out.type = 'STRING'

  // Gemini accepts only its own format values and 400s on the rest of the
  // JSON-Schema vocabulary (uri, email, uuid, date, ...)
  const format = out.format as string | undefined
  if (format) {
    const formatOk =
      (out.type === 'STRING' && (format === 'date-time' || format === 'enum')) ||
      (out.type === 'NUMBER' && (format === 'float' || format === 'double')) ||
      (out.type === 'INTEGER' && (format === 'int32' || format === 'int64'))
    if (!formatOk) delete out.format
  }

  // OBJECT with no properties 400s ("should be non-empty") at any depth
  if (out.type === 'OBJECT') {
    const props = out.properties as Record<string, unknown> | undefined
    if (!props || Object.keys(props).length === 0) return undefined
  }
  // required may only reference surviving properties
  if (Array.isArray(out.required)) {
    const props = (out.properties ?? {}) as Record<string, unknown>
    out.required = (out.required as string[]).filter((r) => r in props)
    if ((out.required as string[]).length === 0) delete out.required
  }
  return out
}

export function toGoogleTools(tools: ToolDefinition[]): Tool[] {
  const declarations = tools.map(
    (t) =>
      ({
        name: t.name,
        description: t.description,
        // undefined = zero-arg tool (top-level schema had no usable properties)
        parameters: sanitizeForGemini(t.inputSchema)
      }) as FunctionDeclaration
  )
  return [{ functionDeclarations: declarations }]
}

export function toGoogleContents(messages: ChatMessage[]): Content[] {
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
        const part = { functionCall: { name: call.name, args: JSON.parse(call.argsJson || '{}') } }
        if (call.thoughtSignature) {
          // Not in the SDK's Part type, but passed through verbatim on the
          // wire — Gemini 3.x rejects the call without it
          ;(part as Record<string, unknown>).thoughtSignature = call.thoughtSignature
        }
        parts.push(part)
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

    let result
    try {
      result = await genModel.generateContentStream(
        { contents: toGoogleContents(messages) },
        { signal: options?.signal }
      )
    } catch (err) {
      // A 400 with tools attached is almost always Gemini rejecting a tool
      // schema shape the sanitizer didn't anticipate — degrade to a tool-free
      // answer (not cached: the model itself supports tools fine)
      if (
        options?.tools?.length &&
        err instanceof Error &&
        /\[400 |INVALID_ARGUMENT/.test(err.message)
      ) {
        throw new ToolsUnsupportedError(model, `${model} rejected the tool definitions`, false)
      }
      throw err
    }

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        yield { type: 'text', delta: text }
      }
      // Walk raw parts instead of chunk.functionCalls(): the helper strips
      // thoughtSignature, which Gemini 3.x requires echoed back
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (!part.functionCall) continue
        yield {
          type: 'tool_call',
          call: {
            // Gemini has no call ids — synthesize one to pair the result locally
            id: `call_${uuidv4()}`,
            name: part.functionCall.name,
            argsJson: JSON.stringify(part.functionCall.args ?? {}),
            thoughtSignature: (part as unknown as { thoughtSignature?: string }).thoughtSignature
          }
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
