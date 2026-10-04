import type { AgentConfig } from '@shared/types'
import type { AgentStream, DebateRoundState } from '@renderer/stores/sessionStore'
import { estimateCost } from './utils'

export interface PhaseRow {
  key: string
  label: string
  input: number
  output: number
  active: boolean
}

export interface TurnTotals {
  rows: PhaseRow[]
  input: number
  output: number
  cost: number
}

const estimateFromContent = (content: string): number => Math.ceil(content.length / 4)

// Derives one turn's phase rows and in/out/cost totals from live-stream
// state. Shared by the stats panel (current turn) and the session store
// (archiving a finished turn when the next one starts) so both agree.
export function deriveTurnStats(params: {
  enabledAgents: AgentConfig[]
  synthesizerAgent: AgentConfig | null
  agentStreams: Record<string, AgentStream>
  debateRounds: DebateRoundState[]
  synthesisStream: AgentStream
  callInputTokens: Record<string, number>
  isDeliberating: boolean
  currentPhase: string | null
}): TurnTotals {
  const {
    enabledAgents,
    synthesizerAgent,
    agentStreams,
    debateRounds,
    synthesisStream,
    callInputTokens,
    isDeliberating,
    currentPhase
  } = params

  const agentInput = (phase: string, round: number, id: string): number => {
    const prefix = `${phase}:${round}:${id}`
    return Object.entries(callInputTokens).reduce((sum, [key, count]) =>
      sum + (key === prefix || key.startsWith(`${prefix}:`) ? count : 0), 0)
  }
  const inputFor = (phase: string, round: number): number =>
    enabledAgents.reduce((sum, a) => sum + agentInput(phase, round, a.id), 0)
  const outputFor = (stream?: AgentStream): number => stream?.reused ? 0 : stream?.tokenCount || estimateFromContent(stream?.content || '')

  // Per-agent in/out accumulators for cost estimation
  const perAgent: Record<string, { agent: AgentConfig; input: number; output: number }> = {}
  const bump = (agent: AgentConfig, input: number, output: number): void => {
    const acc = (perAgent[agent.id] ??= { agent, input: 0, output: 0 })
    acc.input += input
    acc.output += output
  }

  const rows: PhaseRow[] = []

  const initialOut = enabledAgents.reduce(
    (sum, a) => sum + outputFor(agentStreams[a.id]),
    0
  )
  rows.push({
    key: 'initial',
    label: 'Initial answers',
    input: inputFor('initial', 0),
    output: initialOut,
    active: isDeliberating && currentPhase === 'initial'
  })
  for (const a of enabledAgents) {
    bump(a, agentInput('initial', 0, a.id), outputFor(agentStreams[a.id]))
  }

  for (const round of debateRounds) {
    let roundIn = inputFor('debate', round.round)
    let roundOut = 0
    for (const a of enabledAgents) {
      const out = outputFor(round.streams[a.id])
      roundOut += out
      bump(a, agentInput('debate', round.round, a.id), out)
    }
    if (round.moderatorTokens && synthesizerAgent) {
      roundIn += round.moderatorTokens.input
      roundOut += round.moderatorTokens.output
      bump(synthesizerAgent, round.moderatorTokens.input, round.moderatorTokens.output)
    }
    rows.push({
      key: `round-${round.round}`,
      label: `Round ${round.round}${round.moderatorTokens ? ' + moderator' : ''}`,
      input: roundIn,
      output: roundOut,
      active:
        isDeliberating &&
        (currentPhase === 'debate' || currentPhase === 'moderating') &&
        round.round === debateRounds.length
    })
  }

  const synthIn = inputFor('synthesis', 0)
  const synthOut = outputFor(synthesisStream)
  if (synthIn > 0 || synthOut > 0 || currentPhase === 'synthesis') {
    rows.push({
      key: 'synthesis',
      label: 'Synthesis',
      input: synthIn,
      output: synthOut,
      active: isDeliberating && currentPhase === 'synthesis'
    })
    if (synthesizerAgent) bump(synthesizerAgent, synthIn, synthOut)
  }

  const input = rows.reduce((s, r) => s + r.input, 0)
  const output = rows.reduce((s, r) => s + r.output, 0)
  const cost = Object.values(perAgent).reduce(
    (sum, acc) => sum + estimateCost(acc.agent.model, acc.input, acc.output, acc.agent.provider),
    0
  )

  return { rows, input, output, cost }
}
