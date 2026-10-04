import type { MCPToolInfo, ToolResult } from '../../shared/types'
import { estimateMessagesTokens, estimateTokens } from './utils'
import {
  ToolsUnsupportedError,
  type AgentProvider,
  type ChatMessage,
  type ToolCall,
  type ToolDefinition
} from './providers/types'

// The final allowed iteration streams WITHOUT tools, forcing the model to
// answer instead of being cut off mid-loop
const MAX_TOOL_ITERATIONS = 8
const MAX_CALLS_PER_ITERATION = 16
const TOOL_RESULT_MAX_CHARS = 16_000
const PREVIEW_CHARS = 200

export interface ToolIndexEntry {
  serverId: string
  serverName: string
  toolName: string
}

export interface NamespacedTools {
  tools: ToolDefinition[]
  // namespaced name -> dispatch target; never string-split the name instead
  toolIndex: Map<string, ToolIndexEntry>
}

// Strictest provider naming rules: ^[a-zA-Z0-9_-]{1,64}$ (OpenAI/Gemini)
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function shortHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36).slice(0, 2).padStart(2, '0')
}

export function buildNamespacedTools(
  all: { serverId: string; serverName: string; tool: MCPToolInfo }[]
): NamespacedTools {
  const tools: ToolDefinition[] = []
  const toolIndex = new Map<string, ToolIndexEntry>()

  for (const { serverId, serverName, tool } of all) {
    const raw = `${slugify(serverName) || 'server'}__${tool.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    let name = raw.slice(0, 64)
    if (toolIndex.has(name)) {
      name = `${raw.slice(0, 60)}_${shortHash(`${serverId}:${tool.name}`)}`
      if (toolIndex.has(name)) continue // true duplicate registration — skip
    }
    tools.push({
      name,
      // Scope the description: server-authored ones ("Search documentation")
      // read as general-purpose to small models, which then query an issue
      // tracker for world knowledge
      description: `[${serverName} workspace data only — not general knowledge] ${tool.description ?? ''}`,
      inputSchema: tool.inputSchema
    })
    toolIndex.set(name, { serverId, serverName, toolName: tool.name })
  }

  return { tools, toolIndex }
}

export interface ToolLifecycleEvent {
  callId: string
  toolName: string
  serverName: string
  status: 'running' | 'ok' | 'error'
  argsPreview?: string
  resultPreview?: string
  errorMessage?: string
  durationMs?: number
}

// Matches the MCP manager's callTool — kept structural so the loop is testable
// without a live manager
export interface McpBridge {
  callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ content?: unknown; isError?: boolean }>
}

export interface ToolLoopParams {
  provider: AgentProvider
  messages: ChatMessage[]
  model: string
  credential: string
  signal: AbortSignal
  tools?: ToolDefinition[]
  toolIndex?: Map<string, ToolIndexEntry>
  mcp?: McpBridge
  onText: (delta: string) => void
  onTool?: (event: ToolLifecycleEvent) => void
  onNotice?: (message: string) => void
  onIterationStart?: (messages: ChatMessage[], sequence: number, inputTokens: number) => void
  onIterationEnd?: (usage: { inputTokens: number; outputTokens: number; durationMs: number; error?: string }) => void
}

export interface ToolLoopResult {
  content: string
  toolResults: ToolResult[]
  inputTokens: number
  outputTokens: number
}

// Models that rejected the tools parameter — skip tools for them without a
// wasted request on every later call
const toolUnsupportedModels = new Set<string>()

function flattenToolResult(result: { content?: unknown }): string {
  if (typeof result.content === 'string') return result.content
  if (!Array.isArray(result.content)) return JSON.stringify(result.content ?? '')
  return result.content
    .map((block) => {
      const b = block as { type?: string; text?: string }
      return b?.type === 'text' && typeof b.text === 'string'
        ? b.text
        : '[non-text content omitted]'
    })
    .join('\n')
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`
}

// Provider-agnostic agentic loop: stream → collect tool calls → execute via
// MCP → append tool-call/result messages → re-stream, until the model stops
// calling tools. With no tools configured this is a single plain stream.
export async function runToolLoop(p: ToolLoopParams): Promise<ToolLoopResult> {
  const msgs = [...p.messages]
  const modelKey = `${p.provider.name}:${p.model}`
  let toolsActive = !!p.tools?.length && !!p.toolIndex && !!p.mcp && !toolUnsupportedModels.has(modelKey)
  let fullText = ''
  let iteration = 0
  let sequence = 0
  let inputTokens = 0
  let outputTokens = 0
  const toolResults: ToolResult[] = []
  const finish = (): ToolLoopResult => ({ content: fullText, toolResults, inputTokens, outputTokens })

  while (iteration <= MAX_TOOL_ITERATIONS) {
    if (p.signal.aborted) return finish()
    const useTools = toolsActive && iteration < MAX_TOOL_ITERATIONS
    let iterationText = ''
    const calls: ToolCall[] = []
    const callInput = estimateMessagesTokens(msgs, useTools ? p.tools : undefined)
    inputTokens += callInput
    p.onIterationStart?.(msgs, ++sequence, callInput)
    const started = Date.now()
    let callError: string | undefined
    const callController = new AbortController()
    const abortCall = (): void => callController.abort(p.signal.reason)
    p.signal.addEventListener('abort', abortCall, { once: true })
    if (p.signal.aborted) abortCall()

    try {
      const stream = p.provider.streamChat(msgs, p.model, p.credential, {
        signal: callController.signal,
        tools: useTools ? p.tools : undefined
      })
      for await (const chunk of stream) {
        if (p.signal.aborted) break
        if (chunk.type === 'text') {
          iterationText += chunk.delta
          fullText += chunk.delta
          p.onText(chunk.delta)
        } else {
          calls.push(chunk.call)
        }
      }
    } catch (err) {
      callError = err instanceof Error ? err.message : String(err)
      if (!p.signal.aborted && err instanceof ToolsUnsupportedError && toolsActive) {
        if (err.cacheable) toolUnsupportedModels.add(modelKey)
        toolsActive = false
        p.onNotice?.(`${err.message} — answering without MCP tools.`)
        continue // retry the same iteration without tools
      }
      if (!p.signal.aborted) throw err
    } finally {
      p.signal.removeEventListener('abort', abortCall)
      callController.abort()
      const callOutput = estimateTokens(iterationText) + (calls.length ? estimateTokens(JSON.stringify(calls)) : 0)
      outputTokens += callOutput
      p.onIterationEnd?.({ inputTokens: callInput, outputTokens: callOutput, durationMs: Date.now() - started, error: callError })
    }
    iteration++

    if (calls.length === 0 || p.signal.aborted) {
      return finish()
    }

    msgs.push({ role: 'assistant', content: iterationText, toolCalls: calls })

    // Execute sequentially — parallel deliberation agents already put
    // concurrent load on each server; the manager also queues per server
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      const entry = p.toolIndex!.get(call.name)
      const serverName = entry?.serverName ?? 'unknown'

      const pushResult = (text: string, isError: boolean): void => {
        const content = truncate(text, TOOL_RESULT_MAX_CHARS)
        toolResults.push({ callId: call.id, toolName: call.name, serverName, argsJson: call.argsJson, content, isError })
        msgs.push({
          role: 'tool',
          content,
          toolCallId: call.id,
          toolName: call.name,
          isError
        })
      }

      if (p.signal.aborted) {
        pushResult('Cancelled', true)
        continue
      }
      if (i >= MAX_CALLS_PER_ITERATION) {
        pushResult(`Too many tool calls in one turn (max ${MAX_CALLS_PER_ITERATION})`, true)
        continue
      }
      if (!entry) {
        pushResult(`Unknown tool "${call.name}"`, true)
        continue
      }

      let args: Record<string, unknown>
      try {
        args = call.argsJson ? (JSON.parse(call.argsJson) as Record<string, unknown>) : {}
      } catch {
        pushResult('Invalid JSON in tool arguments', true)
        continue
      }

      p.onTool?.({
        callId: call.id,
        toolName: call.name,
        serverName,
        status: 'running',
        argsPreview: call.argsJson.slice(0, PREVIEW_CHARS)
      })

      const started = Date.now()
      try {
        const result = await p.mcp!.callTool(entry.serverId, entry.toolName, args, p.signal)
        const text = flattenToolResult(result)
        const isError = !!result.isError
        pushResult(text, isError)
        p.onTool?.({
          callId: call.id,
          toolName: call.name,
          serverName,
          status: isError ? 'error' : 'ok',
          resultPreview: isError ? undefined : text.slice(0, PREVIEW_CHARS),
          errorMessage: isError ? text.slice(0, PREVIEW_CHARS) : undefined,
          durationMs: Date.now() - started
        })
      } catch (err) {
        if (p.signal.aborted) {
          pushResult('Cancelled', true)
          continue
        }
        const message = err instanceof Error ? err.message : String(err)
        pushResult(message, true)
        p.onTool?.({
          callId: call.id,
          toolName: call.name,
          serverName,
          status: 'error',
          errorMessage: message.slice(0, PREVIEW_CHARS),
          durationMs: Date.now() - started
        })
      }
    }

    if (p.signal.aborted) return finish()

    // Visual break between pre-tool and post-tool text in the streamed message
    if (iterationText) {
      fullText += '\n\n'
      p.onText('\n\n')
    }

  }

  return finish()
}
