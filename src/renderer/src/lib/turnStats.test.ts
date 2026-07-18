import { describe, expect, it } from 'vitest'
import type { AgentConfig, ProviderName } from '@shared/types'
import type { AgentStream, DebateRoundState } from '@renderer/stores/sessionStore'
import { deriveTurnStats } from './turnStats'

const agent = (id: string, provider: ProviderName, model: string, enabled = true): AgentConfig => ({
  id,
  name: `${provider}:${model}`,
  provider,
  model,
  enabled
})

const stream = (content = ''): AgentStream => ({
  content,
  tokenCount: 0,
  isStreaming: false,
  error: null,
  toolCalls: []
})

const round = (
  n: number,
  streams: Record<string, AgentStream>,
  moderatorTokens: { input: number; output: number } | null = null
): DebateRoundState => ({
  round: n,
  streams,
  moderating: false,
  verdict: null,
  moderatorTokens
})

// gpt-4o rates: $0.0025 per 1k input, $0.01 per 1k output
const openaiAgent = agent('a', 'openai', 'gpt-4o')
const ollamaAgent = agent('b', 'ollama', 'llama3.2')

type Params = Parameters<typeof deriveTurnStats>[0]

const baseParams = (overrides: Partial<Params> = {}): Params => ({
  enabledAgents: [openaiAgent, ollamaAgent],
  synthesizerAgent: openaiAgent,
  agentStreams: {},
  debateRounds: [],
  synthesisStream: stream(),
  callInputTokens: {},
  isDeliberating: false,
  currentPhase: null,
  ...overrides
})

describe('deriveTurnStats', () => {
  it('builds the initial row from callInputTokens and stream content estimates', () => {
    const totals = deriveTurnStats(
      baseParams({
        agentStreams: { a: stream('x'.repeat(40)), b: stream('y'.repeat(20)) },
        callInputTokens: { 'initial:0:a': 100, 'initial:0:b': 50 },
        isDeliberating: true,
        currentPhase: 'initial'
      })
    )

    // Output is estimated at ceil(content.length / 4): 10 + 5
    expect(totals.rows).toEqual([
      { key: 'initial', label: 'Initial answers', input: 150, output: 15, active: true }
    ])
    expect(totals.input).toBe(150)
    expect(totals.output).toBe(15)
    // Cost: only the openai agent bills (100 in, 10 out at gpt-4o rates); ollama is $0
    expect(totals.cost).toBeCloseTo(0.0025 * 0.1 + 0.01 * 0.01, 10)
  })

  it('always emits an initial row, even with no data, and omits synthesis when empty and inactive', () => {
    const totals = deriveTurnStats(baseParams())
    expect(totals.rows.map((r) => r.key)).toEqual(['initial'])
    expect(totals.rows[0]).toEqual({
      key: 'initial',
      label: 'Initial answers',
      input: 0,
      output: 0,
      active: false
    })
    expect(totals.input).toBe(0)
    expect(totals.output).toBe(0)
    expect(totals.cost).toBe(0)
  })

  it('adds moderator tokens to the round row and bills them to the synthesizer', () => {
    const totals = deriveTurnStats(
      baseParams({
        debateRounds: [
          round(1, { a: stream('x'.repeat(40)), b: stream('y'.repeat(8)) }, { input: 200, output: 30 })
        ],
        callInputTokens: { 'debate:1:a': 120, 'debate:1:b': 80 }
      })
    )

    const roundRow = totals.rows.find((r) => r.key === 'round-1')
    expect(roundRow).toEqual({
      key: 'round-1',
      label: 'Round 1 + moderator',
      input: 120 + 80 + 200,
      output: 10 + 2 + 30,
      active: false
    })
    // Synthesizer (openai) is billed: debate 120 in / 10 out + moderator 200 in / 30 out.
    // The ollama debater contributes $0.
    expect(totals.cost).toBeCloseTo(0.0025 * (320 / 1000) + 0.01 * (40 / 1000), 10)
  })

  it('drops moderator tokens from totals when there is no synthesizer, but keeps the label', () => {
    const totals = deriveTurnStats(
      baseParams({
        synthesizerAgent: null,
        debateRounds: [round(1, { a: stream('x'.repeat(48)) }, { input: 200, output: 30 })],
        callInputTokens: { 'debate:1:a': 100 }
      })
    )

    const roundRow = totals.rows.find((r) => r.key === 'round-1')
    // Label still advertises the moderator, but its tokens are not counted
    expect(roundRow).toMatchObject({ label: 'Round 1 + moderator', input: 100, output: 12 })
  })

  it('labels rounds without a moderator verdict as plain "Round N"', () => {
    const totals = deriveTurnStats(
      baseParams({ debateRounds: [round(1, { a: stream('hi') })] })
    )
    expect(totals.rows.find((r) => r.key === 'round-1')?.label).toBe('Round 1')
  })

  it('marks only the latest round active during debate/moderating phases', () => {
    const rounds = [round(1, { a: stream('aaaa') }), round(2, { a: stream('bbbb') })]

    const moderating = deriveTurnStats(
      baseParams({ debateRounds: rounds, isDeliberating: true, currentPhase: 'moderating' })
    )
    expect(moderating.rows.find((r) => r.key === 'round-1')?.active).toBe(false)
    expect(moderating.rows.find((r) => r.key === 'round-2')?.active).toBe(true)

    const debating = deriveTurnStats(
      baseParams({ debateRounds: rounds, isDeliberating: true, currentPhase: 'debate' })
    )
    expect(debating.rows.find((r) => r.key === 'round-2')?.active).toBe(true)

    // Nothing is active once the deliberation has ended
    const finished = deriveTurnStats(
      baseParams({ debateRounds: rounds, isDeliberating: false, currentPhase: null })
    )
    expect(finished.rows.every((r) => !r.active)).toBe(true)
  })

  it('includes an empty synthesis row while the synthesis phase is live', () => {
    const totals = deriveTurnStats(
      baseParams({ isDeliberating: true, currentPhase: 'synthesis' })
    )
    const synthRow = totals.rows.find((r) => r.key === 'synthesis')
    expect(synthRow).toEqual({
      key: 'synthesis',
      label: 'Synthesis',
      input: 0,
      output: 0,
      active: true
    })
  })

  it('includes the synthesis row after the fact and bills it to the synthesizer', () => {
    const totals = deriveTurnStats(
      baseParams({
        synthesisStream: stream('s'.repeat(80)),
        callInputTokens: { 'synthesis:0:a': 500 }
      })
    )
    const synthRow = totals.rows.find((r) => r.key === 'synthesis')
    expect(synthRow).toEqual({
      key: 'synthesis',
      label: 'Synthesis',
      input: 500,
      output: 20,
      active: false
    })
    expect(totals.cost).toBeCloseTo(0.0025 * 0.5 + 0.01 * 0.02, 10)
  })

  it('reports zero cost when every agent runs on ollama', () => {
    const local1 = agent('l1', 'ollama', 'llama3.2')
    const local2 = agent('l2', 'ollama', 'mistral')
    const totals = deriveTurnStats(
      baseParams({
        enabledAgents: [local1, local2],
        synthesizerAgent: local1,
        agentStreams: { l1: stream('x'.repeat(400)), l2: stream('y'.repeat(400)) },
        debateRounds: [round(1, { l1: stream('z'.repeat(200)) }, { input: 300, output: 40 })],
        synthesisStream: stream('s'.repeat(100)),
        callInputTokens: { 'initial:0:l1': 1000, 'initial:0:l2': 900, 'debate:1:l1': 800 }
      })
    )
    expect(totals.input).toBeGreaterThan(0)
    expect(totals.output).toBeGreaterThan(0)
    expect(totals.cost).toBe(0)
  })

  it('grand totals equal the sum of the row values', () => {
    const totals = deriveTurnStats(
      baseParams({
        agentStreams: { a: stream('x'.repeat(40)), b: stream('y'.repeat(24)) },
        debateRounds: [
          round(1, { a: stream('p'.repeat(16)), b: stream('q'.repeat(12)) }, { input: 111, output: 22 }),
          round(2, { a: stream('r'.repeat(8)) })
        ],
        synthesisStream: stream('s'.repeat(60)),
        callInputTokens: {
          'initial:0:a': 100,
          'initial:0:b': 90,
          'debate:1:a': 80,
          'debate:1:b': 70,
          'debate:2:a': 60,
          'synthesis:0:a': 50
        }
      })
    )
    expect(totals.rows.map((r) => r.key)).toEqual(['initial', 'round-1', 'round-2', 'synthesis'])
    expect(totals.input).toBe(totals.rows.reduce((s, r) => s + r.input, 0))
    expect(totals.output).toBe(totals.rows.reduce((s, r) => s + r.output, 0))
  })

  it('ignores callInputTokens for agents that are not enabled', () => {
    const totals = deriveTurnStats(
      baseParams({
        enabledAgents: [openaiAgent],
        callInputTokens: { 'initial:0:a': 100, 'initial:0:ghost': 999 }
      })
    )
    expect(totals.rows[0].input).toBe(100)
  })
})
