import React, { useEffect, useRef, useState } from 'react'
import { useSessionStore, type TurnStats } from '@renderer/stores/sessionStore'
import { effectiveSynthesizer, useAgentsStore } from '@renderer/stores/agentsStore'
import { formatCost, formatTokens } from '@renderer/lib/utils'
import { deriveTurnStats, type PhaseRow, type TurnTotals } from '@renderer/lib/turnStats'
import type { LifetimeStats } from '@shared/types'
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Flame, Scale, Zap } from 'lucide-react'

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`
}

function InOutCost({ input, output, cost }: { input: number; output: number; cost: number }): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-0.5">
        <ArrowUp className="h-2.5 w-2.5" />
        {formatTokens(input)} in
      </span>
      <span className="flex items-center gap-0.5">
        <ArrowDown className="h-2.5 w-2.5" />
        {formatTokens(output)} out
      </span>
      <span>{formatCost(cost)}</span>
    </div>
  )
}

function ConsensusLine({ rounds, converged }: { rounds: number; converged: boolean | null }): React.JSX.Element | null {
  if (converged === null) return null
  return converged ? (
    <span className="flex items-center gap-1 text-green-400">
      <CheckCircle2 className="h-3 w-3" />
      Consensus in {rounds} round{rounds > 1 ? 's' : ''}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-amber-400">
      <Scale className="h-3 w-3" />
      No consensus after {rounds} rounds
    </span>
  )
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

// A finished turn — everything visible, nothing hidden in tooltips
function PastTurnCard({ stats }: { stats: TurnStats }): React.JSX.Element {
  return (
    <div className="space-y-1.5 rounded-lg border bg-card/30 p-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Turn {stats.turn}</span>
        <span className="font-mono font-semibold tabular-nums">
          {formatTokens(stats.input + stats.output)}
        </span>
      </div>
      <InOutCost input={stats.input} output={stats.output} cost={stats.cost} />
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          <span className="font-mono tabular-nums">{formatElapsed(stats.elapsedMs)}</span>
        </span>
        <ConsensusLine rounds={stats.rounds} converged={stats.converged} />
      </div>
    </div>
  )
}

function LiveTurnCard({
  turn,
  totals,
  isDeliberating,
  elapsed,
  rounds,
  converged
}: {
  turn: number
  totals: TurnTotals
  isDeliberating: boolean
  elapsed: number | null
  rounds: number
  converged: boolean | null
}): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-lg border bg-card/50 p-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">
          Turn {turn}
          {isDeliberating && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary align-middle" />}
        </span>
        <span className="flex items-center gap-1 font-mono font-semibold tabular-nums">
          <Flame className={`h-3.5 w-3.5 ${isDeliberating ? 'animate-pulse text-orange-400' : 'text-muted-foreground'}`} />
          {formatTokens(totals.input + totals.output)}
        </span>
      </div>
      <InOutCost input={totals.input} output={totals.output} cost={totals.cost} />

      <div className="space-y-1 border-t pt-1.5">
        {totals.rows.map((row) => (
          <StatRow key={row.key} row={row} />
        ))}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        {elapsed !== null && (
          <span className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
            {isDeliberating && <span>and counting…</span>}
          </span>
        )}
        {!isDeliberating && <ConsensusLine rounds={rounds} converged={converged} />}
      </div>
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

  // App-lifetime turn count across all sessions; refreshed as messages persist
  const [lifetime, setLifetime] = useState<LifetimeStats | null>(null)
  useEffect(() => {
    window.elrond.getLifetimeStats().then(setLifetime).catch(() => {})
  }, [messages])

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

  // Running totals across every turn in this view of the session
  const totalTokens =
    turnStats.reduce((s, t) => s + t.input + t.output, 0) +
    (hasTurn ? current.input + current.output : 0)
  const totalInput = turnStats.reduce((s, t) => s + t.input, 0) + (hasTurn ? current.input : 0)
  const totalOutput = turnStats.reduce((s, t) => s + t.output, 0) + (hasTurn ? current.output : 0)
  const totalCost = turnStats.reduce((s, t) => s + t.cost, 0) + (hasTurn ? current.cost : 0)
  const totalTime = turnStats.reduce((s, t) => s + t.elapsedMs, 0) + (elapsed ?? 0)

  // Keep the live turn in view as the card list grows
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turnStats.length, hasTurn])

  return (
    <div className="flex w-56 shrink-0 flex-col border-l bg-background/50">
      {/* Pinned: header + session totals */}
      <div className="space-y-3 px-3 pb-3 pt-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          Stats
          <span className="ml-auto font-normal normal-case">est.</span>
        </div>

        <div className="rounded-lg border bg-card/50 p-3 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <Flame className={`h-4 w-4 ${isDeliberating ? 'animate-pulse text-orange-400' : 'text-muted-foreground'}`} />
            <span className="font-mono text-xl font-semibold tabular-nums">
              {formatTokens(totalTokens)}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">total tokens burnt</div>
          <div className="mt-2">
            <InOutCost input={totalInput} output={totalOutput} cost={totalCost} />
          </div>
          <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            <span className="font-mono tabular-nums">{formatElapsed(totalTime)}</span>
            <span>total</span>
          </div>
        </div>
      </div>

      {/* Scrolls: one card per turn, live turn last */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {turnStats.map((t) => (
          <PastTurnCard key={t.turn} stats={t} />
        ))}
        {hasTurn ? (
          <LiveTurnCard
            turn={turnStats.length + 1}
            totals={current}
            isDeliberating={isDeliberating}
            elapsed={elapsed}
            rounds={debateRounds.length}
            converged={lastVerdict ? lastVerdict.converged : null}
          />
        ) : (
          turnStats.length === 0 && (
            <div className="rounded-lg border border-dashed p-3 text-center text-[10px] text-muted-foreground">
              Send a message to see live token stats
            </div>
          )
        )}
      </div>

      {/* Pinned: app-lifetime footer */}
      <div className="border-t px-3 py-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Turns · all sessions</span>
          <span className="font-mono tabular-nums">{lifetime?.turns ?? '–'}</span>
        </div>
      </div>
    </div>
  )
}
