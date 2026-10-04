import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../db/schema'
import { createDeliberationRunner, type DeliberationRuntime, type ProviderCallRecord } from './runner'
import { contentToText, type AgentProvider, type ChatMessage } from './providers/types'
import type { AgentConfig, DeliberationRequest, Message, ModeratorVerdictEvent, PhaseChange } from '../../shared/types'

const agents: AgentConfig[] = [
  { id: 'a', name: 'Ada', provider: 'openai', model: 'a', enabled: true },
  { id: 'b', name: 'Ben', provider: 'anthropic', model: 'b', enabled: true }
]
const databases: Database.Database[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))

type Reply = string | Error | (() => string)
function harness(scripts: Record<string, Reply[]> = {}, runtimeOverrides: Partial<DeliberationRuntime> = {}) {
  const db = new Database(':memory:')
  databases.push(db)
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  db.prepare("INSERT INTO sessions (id, title) VALUES ('test', 'Test')").run()
  const events: { channel: string; data: unknown }[] = []
  const calls: ProviderCallRecord[] = []
  const prompts: { phase: string; model: string; messages: ChatMessage[] }[] = []
  const counters: Record<string, number> = {}
  const provider: AgentProvider = {
    name: 'test',
    async *streamChat(messages, model) {
      const last = contentToText(messages.at(-1)!.content)
      const phase = last.includes('impartial moderator') ? 'moderator'
        : last.includes('THE final answer') ? 'synthesis'
        : last.includes('structured multi-agent debate') ? 'debate' : 'initial'
      prompts.push({ phase, model, messages })
      const key = `${model}:${phase}`
      const i = counters[key] ?? 0
      counters[key] = i + 1
      const fallback = phase === 'initial' ? `${model} initial position` : phase === 'debate'
        ? `## Critique\nOther view disputed.\n## Revised Answer\n${model} revised position ${i}`
        : phase === 'moderator' ? '{"converged":true,"disagreements":[],"summary":"Agreement."}' : 'Final synthesis'
      const entries = scripts[key] ?? [fallback]
      const reply = entries[Math.min(i, entries.length - 1)]
      if (reply instanceof Error) throw reply
      yield { type: 'text', delta: typeof reply === 'function' ? reply() : reply }
    }
  }
  const runner = createDeliberationRunner({
    getDb: () => db,
    send: (channel, data) => events.push({ channel, data }),
    providers: { openai: provider, anthropic: provider, google: provider, ollama: provider },
    resolveCredential: async () => 'test',
    onCall: (call) => calls.push(call),
    ...runtimeOverrides
  })
  const run = (overrides: Partial<DeliberationRequest> = {}) => runner.startDeliberation({
    sessionId: 'test', prompt: 'Compare approaches', agents, enableDebate: true,
    maxDebateRounds: 3, synthesizerAgentId: 'a', mcpTools: false, ...overrides
  })
  const verdicts = () => events.filter((e) => e.channel === 'stream:moderator').map((e) => e.data as ModeratorVerdictEvent)
  const complete = () => events.filter((e) => e.channel === 'stream:phase').map((e) => e.data as PhaseChange).find((p) => p.phase === 'complete')
  const messages = () => db.prepare('SELECT * FROM messages ORDER BY rowid').all() as Message[]
  return { db, runner, run, calls, prompts, events, verdicts, complete, messages }
}

const unresolved = '{"converged":false,"disagreements":[{"description":"Cache lifetime"}],"summary":"TTL remains disputed."}'

describe('deliberation runner', () => {
  it('threads stable issue IDs into later prompts and stops stagnation with positions intact', async () => {
    const h = harness({
      'a:moderator': [unresolved],
      'a:debate': ['## Critique\nTTL disputed\n## Revised Answer\nAda position', 'UNCHANGED'],
      'b:debate': ['## Critique\nTTL disputed\n## Revised Answer\nBen position', 'STATUS {"disputed":["I1"],"newIssues":[]}\n## Revised Answer\nUNCHANGED']
    })
    await h.run()
    expect(h.verdicts().map((v) => v.terminationReason)).toEqual([null, 'stagnated'])
    expect(h.verdicts()[0].continuing).toBe(true)
    expect(h.verdicts()[1].converged).toBe(false)
    expect(h.calls.filter((c) => c.phase === 'moderator')).toHaveLength(1)
    for (const p of h.prompts.filter((p) => p.phase === 'debate').slice(2)) {
      expect(contentToText(p.messages.at(-1)!.content)).toContain('I1: Cache lifetime')
    }
    const synth = h.prompts.find((p) => p.phase === 'synthesis')!
    expect(contentToText(synth.messages[0].content)).toContain('Ada position')
    expect(contentToText(synth.messages[0].content)).toContain('Ben position')
    expect(contentToText(synth.messages[0].content)).not.toContain('UNCHANGED')
    expect(h.messages().filter((m) => m.role === 'debate' && m.round === 2).map((m) => m.content)).toEqual(['Ada position', 'Ben position'])
    expect(h.messages().find((m) => m.role === 'user')?.termination_reason).toBe('stagnated')
    expect(h.complete()?.terminationReason).toBe('stagnated')
    const moderatorRows = h.messages().filter((m) => m.role === 'moderator')
    expect(moderatorRows[0].token_count).toBe(h.calls.find((c) => c.phase === 'moderator')!.outputTokens)
    expect(moderatorRows[1].token_count).toBe(0)
  })

  it('asks the moderator when UNCHANGED has no established open issues', async () => {
    const h = harness({ 'a:debate': ['UNCHANGED'], 'b:debate': ['UNCHANGED'] })
    await h.run()
    expect(h.calls.filter((c) => c.phase === 'moderator')).toHaveLength(1)
    expect(h.complete()?.terminationReason).toBe('converged')
  })

  it('preserves whitespace in an unchanged initial position verbatim', async () => {
    const original = '  Complete answer with formatting.\n\n'
    const h = harness({ 'a:initial': [original], 'a:debate': ['UNCHANGED'], 'b:debate': ['UNCHANGED'] })
    await h.run()
    expect(h.messages().find((m) => m.role === 'debate' && m.agent_id === 'a')!.content).toBe(original)
    expect(contentToText(h.prompts.find((p) => p.phase === 'synthesis')!.messages[0].content)).toContain(original)
  })

  it('refreshes the moderator inventory when unchanged agents report a new issue', async () => {
    const h = harness({
      'a:moderator': [unresolved, '{"converged":true,"disagreements":[],"summary":"Resolved."}'],
      'a:debate': ['## Revised Answer\nA', 'STATUS {"disputed":["I1"],"newIssues":["Security"]}\n## Revised Answer\nUNCHANGED'],
      'b:debate': ['## Revised Answer\nB', 'UNCHANGED']
    })
    await h.run()
    expect(h.calls.filter((c) => c.phase === 'moderator')).toHaveLength(2)
    expect(h.complete()?.terminationReason).toBe('converged')
  })

  it.each([['bad JSON'], [new Error('moderator offline')]])('ends a failed moderator review honestly and still synthesizes: %s', async (reply) => {
    const h = harness({ 'a:moderator': [unresolved, reply] })
    await h.run()
    const verdict = h.verdicts().at(-1)!
    expect(verdict).toMatchObject({ converged: false, continuing: false, terminationReason: 'degraded', disagreements: ['I1: Cache lifetime'] })
    expect(h.messages().some((m) => m.role === 'synthesis')).toBe(true)
    expect(h.complete()?.terminationReason).toBe('degraded')
    expect(h.calls.filter((c) => c.phase === 'moderator').every((c) => c.inputTokens > 0)).toBe(true)
    expect(h.verdicts().at(-1)!.inputTokens).toBeGreaterThan(0)
  })

  it('marks fewer than two fresh responses as degraded while retaining prior answers', async () => {
    const h = harness({ 'b:debate': [new Error('agent offline')] })
    await h.run()
    expect(h.complete()?.terminationReason).toBe('degraded')
    expect(h.verdicts()[0].converged).toBe(false)
    expect(h.calls.filter((c) => c.phase === 'moderator')).toHaveLength(0)
    expect(contentToText(h.prompts.find((p) => p.phase === 'synthesis')!.messages[0].content)).toContain('b initial position')
  })

  it('distinguishes the round limit from agreement', async () => {
    const h = harness({ 'a:moderator': [unresolved] })
    await h.run({ maxDebateRounds: 2 })
    expect(h.verdicts().map((v) => v.terminationReason)).toEqual([null, 'budget_exhausted'])
    expect(h.complete()?.terminationReason).toBe('budget_exhausted')
  })

  it('records a debate-disabled outcome and performs synthesis without moderation', async () => {
    const h = harness()
    await h.run({ enableDebate: false })
    expect(h.verdicts()).toHaveLength(0)
    expect(h.complete()?.terminationReason).toBe('not_requested')
    expect(h.calls.map((c) => c.phase)).toEqual(['initial', 'initial', 'synthesis'])
  })

  it('reuses a single answer without billing it twice', async () => {
    const h = harness()
    await h.run({ agents: [agents[0]] })
    expect(h.calls).toHaveLength(1)
    expect(h.complete()?.terminationReason).toBe('single_agent')
    expect(h.messages().find((m) => m.role === 'synthesis')).toMatchObject({ content: 'a initial position', token_count: 0 })
    expect(h.events.filter((e) => e.channel === 'stream:done').at(-1)?.data).toMatchObject({ reused: true, tokenCount: 0 })
  })

  it('records total fan-out failure as degraded, without pretending a synthesis exists', async () => {
    const h = harness({ 'a:initial': [new Error('down')], 'b:initial': [new Error('down')] })
    await h.run()
    expect(h.complete()?.terminationReason).toBe('degraded')
    expect(h.messages().find((m) => m.role === 'user')?.termination_reason).toBe('degraded')
    expect(h.messages().some((m) => m.role === 'synthesis')).toBe(false)
  })

  it.each(['initial', 'debate'] as const)('does not count empty %s answers as responding agents', async (phase) => {
    const h = harness({ [`a:${phase}`]: [''], [`b:${phase}`]: ['   '] })
    await h.run()
    expect(h.complete()?.terminationReason).toBe('degraded')
    expect(h.verdicts().every((v) => !v.converged)).toBe(true)
    expect(h.calls.filter((c) => c.phase === 'moderator')).toHaveLength(0)
  })

  it('persists cancellation without emitting a completion event that could clobber a new turn', async () => {
    const h = harness({ 'a:initial': [() => { h.runner.cancelDeliberation(); return 'partial' }] })
    await h.run()
    expect(h.complete()).toBeUndefined()
    expect(h.messages().find((m) => m.role === 'user')?.termination_reason).toBe('cancelled')
  })

  it('uses only the supplied database and event sink', async () => {
    const h = harness()
    const other = new Database(':memory:')
    databases.push(other)
    runMigrations(other)
    other.prepare("INSERT INTO sessions (id, title) VALUES ('sentinel', 'Do not touch')").run()
    await h.run()
    expect(other.prepare('SELECT * FROM messages').all()).toEqual([])
    expect(other.prepare('SELECT title FROM sessions').get()).toEqual({ title: 'Do not touch' })
    expect(h.events.some((e) => e.channel === 'stream:done')).toBe(true)
    expect(h.calls.every((c) => c.callId && c.model && c.inputTokens > 0)).toBe(true)
  })

  it.each([false, true])('persists bounded model-facing tool evidence, including errors (%s), and accounts for each call', async (isError) => {
    let modelFacingResult = ''
    const provider: AgentProvider = {
      name: `tool-persistence-${isError}`,
      async *streamChat(messages) {
        if (messages.at(-1)?.role === 'tool') {
          modelFacingResult = contentToText(messages.at(-1)!.content)
          yield { type: 'text', delta: 'Answer after retrieval' }
        } else yield { type: 'tool_call', call: { id: 'lookup-1', name: 'docs__lookup', argsJson: '{"query":"evidence"}' } }
      }
    }
    const h = harness({}, {
      providers: { openai: provider, anthropic: provider, google: provider, ollama: provider },
      listAllTools: async () => [{ serverId: 'docs', serverName: 'Docs', tool: { name: 'lookup', inputSchema: { type: 'object' } } }],
      callTool: async () => ({ content: [{ type: 'text', text: 'Evidence '.repeat(3000) }], isError })
    })
    await h.run({ agents: [agents[0]], mcpTools: true })
    const evidence = JSON.parse(h.messages().find((m) => m.role === 'agent')!.tool_results!)
    expect(evidence).toEqual([{ callId: 'lookup-1', toolName: 'docs__lookup', serverName: 'Docs', argsJson: '{"query":"evidence"}', content: modelFacingResult, isError }])
    expect(modelFacingResult).toContain('[truncated')
    expect(modelFacingResult.length).toBeLessThan(16_100)
    const starts = h.events.filter((e) => e.channel === 'stream:start').map((e) => e.data as { callId: string; inputTokens: number; estimated: boolean })
    expect(starts).toHaveLength(2)
    expect(new Set(starts.map((s) => s.callId)).size).toBe(2)
    expect(starts.every((s) => s.estimated)).toBe(true)
    expect(starts.reduce((sum, s) => sum + s.inputTokens, 0)).toBe(h.calls.reduce((sum, c) => sum + c.inputTokens, 0))
    expect(h.calls[1].inputTokens).toBeGreaterThan(h.calls[0].inputTokens)
  })
})
