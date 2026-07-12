import React, { useEffect, useState } from 'react'
import { useSessionStore } from '@renderer/stores/sessionStore'
import { effectiveSynthesizer, useAgentsStore } from '@renderer/stores/agentsStore'
import { estimateCost, formatCost, formatTokens } from '@renderer/lib/utils'
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Flame, Scale, Zap } from 'lucide-react'

interface PhaseRow {
  key: string
  label: string
  input: number
  output: number
  active: boolean
}

const estimateFromContent = (content: string): number => Math.ceil(content.length / 4)

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`
}

function StatRow({ row }: { row: PhaseRow }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className={row.active ? 'text-foreground' : 'text-muted-foreground'}>
        {row.label}
        {row.active && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary align-middle" />}
      </span>
      <span className="flex items-center gap-2 font-mono tabular-nums text-muted-foreground">
        <span className="flex items-center gap-0.5">
          <ArrowUp className="h-2.5 w-2.5" />
          {formatTokens(row.input)}
        </span>
        <span className="flex items-center gap-0.5">
          <ArrowDown className="h-2.5 w-2.5" />
          {formatTokens(row.output)}
        </span>
      </span>
    </div>
  )
}

export function StatsPanel(): React.JSX.Element {
  const {
    messages,
    isDeliberating,
    currentPhase,
    agentStreams,
    debateRounds,
    synthesisStream,
    callInputTokens,
    deliberationStartedAt,
    deliberationEndedAt
  } = useSessionStore()
  const { agents, synthesizerAgentId } = useAgentsStore()
  const synthesizerAgent = effectiveSynthesizer({ agents, synthesizerAgentId })

  // Ticks the elapsed timer while a deliberation is running
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isDeliberating) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isDeliberating])

  const enabledAgents = agents.filter((a) => a.enabled)
  const inputFor = (phase: string, round: number): number =>
    enabledAgents.reduce((sum, a) => sum + (callInputTokens[`${phase}:${round}:${a.id}`] ?? 0), 0)

  // Per-agent in/out accumulators for cost estimation
  const perAgent: Record<string, { input: number; output: number }> = {}
  const bump = (agentId: string, input: number, output: number): void => {
    const acc = (perAgent[agentId] ??= { input: 0, output: 0 })
    acc.input += input
    acc.output += output
  }

  const rows: PhaseRow[] = []

  const initialOut = enabledAgents.reduce(
    (sum, a) => sum + estimateFromContent(agentStreams[a.id]?.content || ''),
    0
  )
  const hasTurn = deliberationStartedAt !== null
  if (hasTurn) {
    rows.push({
      key: 'initial',
      label: 'Initial answers',
      input: inputFor('initial', 0),
      output: initialOut,
      active: isDeliberating && currentPhase === 'initial'
    })
    for (const a of enabledAgents) {
      bump(a.id, callInputTokens[`initial:0:${a.id}`] ?? 0, estimateFromContent(agentStreams[a.id]?.content || ''))
    }

    for (const round of debateRounds) {
      let roundIn = inputFor('debate', round.round)
      let roundOut = 0
      for (const a of enabledAgents) {
        const out = estimateFromContent(round.streams[a.id]?.content || '')
        roundOut += out
        bump(a.id, callInputTokens[`debate:${round.round}:${a.id}`] ?? 0, out)
      }
      if (round.moderatorTokens && synthesizerAgent) {
        roundIn += round.moderatorTokens.input
        roundOut += round.moderatorTokens.output
        bump(synthesizerAgent.id, round.moderatorTokens.input, round.moderatorTokens.output)
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
    const synthOut = estimateFromContent(synthesisStream.content)
    if (synthIn > 0 || synthOut > 0 || currentPhase === 'synthesis') {
      rows.push({
        key: 'synthesis',
        label: 'Synthesis',
        input: synthIn,
        output: synthOut,
        active: isDeliberating && currentPhase === 'synthesis'
      })
      if (synthesizerAgent) bump(synthesizerAgent.id, synthIn, synthOut)
    }
  }

  const turnInput = rows.reduce((s, r) => s + r.input, 0)
  const turnOutput = rows.reduce((s, r) => s + r.output, 0)
  const turnCost = Object.entries(perAgent).reduce((sum, [agentId, acc]) => {
    const agent = agents.find((a) => a.id === agentId)
    return sum + estimateCost(agent?.model || '', acc.input, acc.output, agent?.provider)
  }, 0)

  const elapsed = deliberationStartedAt
    ? Math.max(0, (deliberationEndedAt ?? now) - deliberationStartedAt)
    : null

  const lastVerdict = debateRounds.length > 0 ? debateRounds[debateRounds.length - 1].verdict : null

  // Session lifetime: everything the agents have ever generated in this session
  const sessionGenerated = messages.reduce((s, m) => s + (m.token_count || 0), 0)
  const sessionTurns = messages.filter((m) => m.role === 'user').length

  return (
    <div className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-background/50 px-3 py-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Zap className="h-3.5 w-3.5" />
        Stats
        <span className="ml-auto font-normal normal-case">est.</span>
      </div>

      {hasTurn ? (
        <>
          {/* Big burn counter */}
          <div className="rounded-lg border bg-card/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Flame className={`h-4 w-4 ${isDeliberating ? 'animate-pulse text-orange-400' : 'text-muted-foreground'}`} />
              <span className="font-mono text-xl font-semibold tabular-nums">
                {formatTokens(turnInput + turnOutput)}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">tokens burnt this turn</div>
            <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <ArrowUp className="h-2.5 w-2.5" />
                {formatTokens(turnInput)} in
              </span>
              <span className="flex items-center gap-0.5">
                <ArrowDown className="h-2.5 w-2.5" />
                {formatTokens(turnOutput)} out
              </span>
              <span>{formatCost(turnCost)}</span>
            </div>
          </div>

          {/* Per-phase breakdown */}
          <div className="space-y-1.5">
            {rows.map((row) => (
              <StatRow key={row.key} row={row} />
            ))}
          </div>

          {/* Timer + outcome */}
          <div className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
            {elapsed !== null && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
                {isDeliberating && <span className="text-[10px]">and counting…</span>}
              </div>
            )}
            {lastVerdict &&
              (lastVerdict.converged ? (
                <div className="flex items-center gap-1.5 text-green-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Consensus in {debateRounds.length} round{debateRounds.length > 1 ? 's' : ''}
                </div>
              ) : !lastVerdict.continuing ? (
                <div className="flex items-center gap-1.5 text-amber-400">
                  <Scale className="h-3 w-3" />
                  No consensus after {debateRounds.length} rounds
                </div>
              ) : null)}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed p-3 text-center text-[10px] text-muted-foreground">
          Send a message to see live token stats
        </div>
      )}

      {/* Session lifetime */}
      <div className="mt-auto space-y-1 border-t pt-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Session generated</span>
          <span className="font-mono tabular-nums">{formatTokens(sessionGenerated)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Turns</span>
          <span className="font-mono tabular-nums">{sessionTurns}</span>
        </div>
      </div>
    </div>
  )
}
