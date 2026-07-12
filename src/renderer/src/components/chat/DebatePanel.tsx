import React, { useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { MarkdownContent } from './MarkdownContent'
import { Badge } from '@renderer/components/ui/badge'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Scale, Swords } from 'lucide-react'
import type { ProviderName } from '@shared/types'
import type { DebateVerdict } from '@renderer/stores/sessionStore'

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google'
}

export interface DebateEntry {
  provider: ProviderName
  content: string
  isStreaming: boolean
  error?: string | null
}

export interface DebateRoundView {
  round: number
  entries: DebateEntry[]
  verdict: DebateVerdict | null
  moderating: boolean
}

interface DebatePanelProps {
  rounds: DebateRoundView[]
  maxRounds?: number
  isActive: boolean
}

function VerdictBanner({ round }: { round: DebateRoundView }): React.JSX.Element | null {
  if (round.moderating) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        <span>Moderator is reviewing round {round.round}…</span>
      </div>
    )
  }
  const v = round.verdict
  if (!v) return null
  if (v.converged) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-2.5 py-1.5 text-xs text-green-400">
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        <span>Moderator: {v.summary || `consensus reached after round ${round.round}`}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-400">
      <Scale className="h-3 w-3 shrink-0" />
      <span>
        Moderator: {v.summary || 'agents still disagree'}
        {v.continuing
          ? ` — starting round ${round.round + 1}`
          : ' — max rounds reached, moving to synthesis'}
      </span>
    </div>
  )
}

export function DebatePanel({ rounds, maxRounds, isActive }: DebatePanelProps): React.JSX.Element {
  const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({})

  const visibleRounds = rounds.filter(
    (r) => r.entries.some((e) => e.content || e.isStreaming || e.error) || r.verdict || r.moderating
  )

  if (visibleRounds.length === 0 && !isActive) return <></>

  // While the debate runs, the latest round is open by default; a user toggle overrides
  const latestRound = visibleRounds.length > 0 ? visibleRounds[visibleRounds.length - 1].round : 0

  return (
    <div className="rounded-lg border border-dashed bg-card/50">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
        <Swords className="h-4 w-4 text-muted-foreground" />
        <span>Debate</span>
        {isActive && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      <div className="space-y-2 border-t px-3 py-2">
        {visibleRounds.map((round) => {
          const expanded = expandedRounds[round.round] ?? (isActive && round.round === latestRound)
          const streaming = round.entries.some((e) => e.isStreaming)
          return (
            <div key={round.round} className="space-y-2">
              <button
                className="flex w-full items-center gap-1.5 text-xs font-medium"
                onClick={() =>
                  setExpandedRounds((prev) => ({ ...prev, [round.round]: !expanded }))
                }
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>
                  Round {round.round}
                  {maxRounds ? ` of ${maxRounds}` : ''}
                </span>
                {streaming && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </button>

              {expanded && (
                <div className="space-y-3 pl-5">
                  {round.entries.map((entry) => (
                    <div key={entry.provider} className="space-y-1">
                      <Badge variant="secondary" className="text-[10px]">
                        {PROVIDER_LABELS[entry.provider]}
                      </Badge>
                      <div>
                        {entry.error ? (
                          <div className="text-xs text-destructive">{entry.error}</div>
                        ) : entry.content ? (
                          <MarkdownContent
                            content={entry.content}
                            className={cn('prose-xs text-xs', entry.isStreaming && 'streaming-cursor')}
                          />
                        ) : entry.isStreaming ? (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Critiquing...
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <VerdictBanner round={round} />
            </div>
          )
        })}

        {visibleRounds.length === 0 && (
          <div className="flex items-center gap-1 py-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Starting debate...
          </div>
        )}
      </div>
    </div>
  )
}
