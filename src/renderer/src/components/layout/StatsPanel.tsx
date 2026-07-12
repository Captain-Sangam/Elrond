import React, { useEffect, useState } from 'react'
import { useSessionStore, type TurnStats } from '@renderer/stores/sessionStore'
import { effectiveSynthesizer, useAgentsStore } from '@renderer/stores/agentsStore'
import { formatCost, formatTokens } from '@renderer/lib/utils'
import { deriveTurnStats, type PhaseRow } from '@renderer/lib/turnStats'
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Flame, Scale, Zap } from 'lucide-react'

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

// Compact one-line summary of an archived (finished) turn
function PastTurnRow({ stats }: { stats: TurnStats }): React.JSX.Element {
  return (
    <div
      className="flex items-center justify-between rounded-md border bg-card/30 px-2 py-1.5 text-xs"
      title={`↑ ${formatTokens(stats.input)} in · ↓ ${formatTokens(stats.output)} out · ${formatElapsed(stats.elapsedMs)}${
        stats.rounds > 0 ? ` · ${stats.rounds} round${stats.rounds > 1 ? 's' : ''}` : ''
      }`}
    >
      <span className="text-muted-foreground">Turn {stats.turn}</span>
      <span className="flex items-center gap-2 font-mono tabular-nums text-muted-foreground">
        <span>{formatTokens(stats.input + stats.output)}</span>
        <span>{formatCost(stats.cost)}</span>
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
    deliberationEndedAt,
    turnStats
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

  const hasTurn = deliberationStartedAt !== null
  const current = deriveTurnStats({
    enabledAgents: agents.filter((a) => a.enabled),
    synthesizerAgent,
    agentStreams,
    debateRounds,
    synthesisStream,
    callInputTokens,
    isDeliberating,
    currentPhase
  })

  const elapsed = deliberationStartedAt
    ? Math.max(0, (deliberationEndedAt ?? now) - deliberationStartedAt)
    : null

  const lastVerdict = debateRounds.length > 0 ? debateRounds[debateRounds.length - 1].verdict : null

  // Running totals across every turn seen in this view of the session
  const totalTokens =
    turnStats.reduce((s, t) => s + t.input + t.output, 0) +
    (hasTurn ? current.input + current.output : 0)
  const totalCost = turnStats.reduce((s, t) => s + t.cost, 0) + (hasTurn ? current.cost : 0)

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

      {/* Finished turns stack up here; the live turn renders below them */}
      {turnStats.length > 0 && (
        <div className="space-y-1">
          {turnStats.map((t) => (
            <PastTurnRow key={t.turn} stats={t} />
          ))}
        </div>
      )}

      {hasTurn ? (
        <>
          {/* Big burn counter for the current turn */}
          <div className="rounded-lg border bg-card/50 p-3 text-center">
            <div className="text-[10px] font-medium text-muted-foreground">
              Turn {turnStats.length + 1}
            </div>
            <div className="mt-1 flex items-center justify-center gap-1.5">
              <Flame className={`h-4 w-4 ${isDeliberating ? 'animate-pulse text-orange-400' : 'text-muted-foreground'}`} />
              <span className="font-mono text-xl font-semibold tabular-nums">
                {formatTokens(current.input + current.output)}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">tokens burnt this turn</div>
            <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <ArrowUp className="h-2.5 w-2.5" />
                {formatTokens(current.input)} in
              </span>
              <span className="flex items-center gap-0.5">
                <ArrowDown className="h-2.5 w-2.5" />
                {formatTokens(current.output)} out
              </span>
              <span>{formatCost(current.cost)}</span>
            </div>
          </div>

          {/* Per-phase breakdown */}
          <div className="space-y-1.5">
            {current.rows.map((row) => (
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
        turnStats.length === 0 && (
          <div className="rounded-lg border border-dashed p-3 text-center text-[10px] text-muted-foreground">
            Send a message to see live token stats
          </div>
        )
      )}

      {/* Running + lifetime totals */}
      <div className="mt-auto space-y-1 border-t pt-3 text-xs text-muted-foreground">
        {totalTokens > 0 && (
          <div className="flex items-center justify-between font-medium text-foreground">
            <span>Total</span>
            <span className="flex items-center gap-2 font-mono tabular-nums">
              <span>{formatTokens(totalTokens)}</span>
              <span>{formatCost(totalCost)}</span>
            </span>
          </div>
        )}
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
