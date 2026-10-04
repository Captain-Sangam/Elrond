import { describe, expect, it, vi } from 'vitest'
// Importing these services would violate headless isolation even without a call.
vi.mock('electron', () => { throw new Error('Benchmark imported Electron') })
vi.mock('../../src/main/keychain', () => { throw new Error('Benchmark imported Keychain') })
vi.mock('../../src/main/db/index', () => { throw new Error('Benchmark imported the application database singleton') })
import { fixtureConfig, fixtureProvider } from './fixture'
import { runBenchmarkSuite, validateConfig, validatePrompts } from './suite'
import type { BenchmarkPrompt } from './types'
import { contentToText, type AgentProvider } from '../../src/main/orchestrator/providers/types'

const prompt: BenchmarkPrompt = { id: 'one', category: 'reasoning', split: 'held-out', prompt: 'A test question', reference: 'A reference', rubric: ['Correct'] }
const providers = { openai: fixtureProvider, anthropic: fixtureProvider, google: fixtureProvider, ollama: fixtureProvider }

describe('isolated benchmark suite', () => {
  it('runs the same fixed agents across baseline and Phase A with captured calls and isolated databases', async () => {
    const { results, blindItems } = await runBenchmarkSuite({ config: fixtureConfig, prompts: [prompt], execution: 'fixture', revision: 'test', providers, resolveCredential: async () => 'fixture' })
    expect(results.runs).toHaveLength(2)
    const baseline = results.runs.find((r) => r.mode === 'baseline')!
    const current = results.runs.find((r) => r.mode === 'phase-a')!
    expect(baseline).toMatchObject({ rounds: 3, terminationReason: 'budget_exhausted' })
    expect(current).toMatchObject({ rounds: 2, terminationReason: 'stagnated' })
    expect(baseline.calls).toHaveLength(12)
    expect(current.calls).toHaveLength(8)
    for (const run of results.runs) {
      expect(run.synthesis).toBeTruthy()
      expect(run.calls.every((c) => c.callId && c.inputTokens > 0 && c.durationMs >= 0)).toBe(true)
      expect(run.inputTokens).toBe(run.calls.reduce((s, c) => s + c.inputTokens, 0))
      expect(run.outputTokens).toBe(run.calls.reduce((s, c) => s + c.outputTokens, 0))
      expect(run.messages.every((m) => m.session_id === run.id)).toBe(true)
      expect(run.calls.every((c) => fixtureConfig.agents.some((a) => a.id === c.agentId && a.model === c.model && a.provider === c.provider))).toBe(true)
    }
    expect(new Set(results.runs.flatMap((r) => r.messages.map((m) => m.id))).size).toBe(results.runs.reduce((s, r) => s + r.messages.length, 0))
    expect(blindItems).toHaveLength(2)
    expect(Object.keys(results.blindMapping)).toHaveLength(2)
    for (const item of blindItems) {
      expect(item).not.toHaveProperty('mode')
      expect(item).not.toHaveProperty('terminationReason')
      expect(item.positions).toHaveLength(2)
      expect(item.positions.every((p) => p.participant.startsWith('Participant'))).toBe(true)
      expect(item.positions.every((p) => !p.content.includes('STATUS') && !p.content.includes('UNCHANGED'))).toBe(true)
    }
  })

  it('keeps failed provider calls in estimated usage and produces no fabricated synthesis', async () => {
    const fail = { name: 'fail', async *streamChat() { throw new Error('offline'); yield { type: 'text' as const, delta: '' } } }
    const { results } = await runBenchmarkSuite({ config: fixtureConfig, prompts: [prompt], execution: 'fixture', revision: 'test', providers: { ...providers, ollama: fail }, resolveCredential: async () => 'fixture' })
    expect(results.runs.every((r) => r.calls.length === 2 && r.inputTokens > 0 && r.synthesis === null && r.terminationReason === 'degraded')).toBe(true)
  })

  it('cancels timed-out runs and counts a debate round even without a completed verdict', async () => {
    const slow: AgentProvider = {
      name: 'timeout-fixture',
      async *streamChat(messages, _model, _credential, options) {
        if (contentToText(messages.at(-1)!.content).includes('structured multi-agent debate')) {
          await new Promise<void>((resolve) => options!.signal!.addEventListener('abort', () => resolve(), { once: true }))
          return
        }
        yield { type: 'text', delta: 'Initial position' }
      }
    }
    const { results } = await runBenchmarkSuite({ config: { ...fixtureConfig, timeoutMs: 20 }, prompts: [prompt], execution: 'fixture', revision: 'test', providers: { ...providers, ollama: slow }, resolveCredential: async () => 'fixture' })
    results.runs.forEach((r) => {
      expect(r).toMatchObject({ rounds: 1, terminationReason: 'cancelled', synthesis: null })
      expect(r.verdicts).toHaveLength(0)
      expect(r.calls.filter((c) => c.phase === 'debate')).toHaveLength(2)
    })
  })

  it('uses explicit prices for every provider call', async () => {
    const config = { ...fixtureConfig, agents: fixtureConfig.agents.map((a) => ({ ...a, inputUsdPerMillion: 2, outputUsdPerMillion: 5 })) }
    const { results } = await runBenchmarkSuite({ config, prompts: [prompt], execution: 'fixture', revision: 'test', providers, resolveCredential: async () => 'fixture' })
    results.runs.forEach((r) => expect(r.estimatedCostUsd).toBeCloseTo((r.inputTokens * 2 + r.outputTokens * 5) / 1_000_000))
  })

  it('rejects invalid or ambiguous configurations before any provider requests', () => {
    expect(() => validateConfig({ ...fixtureConfig, agents: [fixtureConfig.agents[0]] })).toThrow()
    expect(() => validateConfig({ ...fixtureConfig, synthesizerAgentId: 'missing' })).toThrow()
    expect(() => validateConfig({ ...fixtureConfig, minHeldOutSamples: 1 })).toThrow()
    expect(() => validateConfig({ ...fixtureConfig, agents: fixtureConfig.agents.map((a) => ({ ...a, inputUsdPerMillion: NaN })) })).toThrow()
    expect(() => validatePrompts([prompt, prompt])).toThrow()
    expect(() => validatePrompts([{ ...prompt, rubric: [] }])).toThrow()
  })
})
