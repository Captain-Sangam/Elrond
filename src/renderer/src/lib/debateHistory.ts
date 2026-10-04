import type { Message, DebateTerminationReason } from '@shared/types'
import type { DebateVerdict } from '@renderer/stores/sessionStore'

export function parseStoredVerdict(msg: Message | null, hasNextRound: boolean): DebateVerdict | null {
  if (!msg) return null
  try {
    const v = JSON.parse(msg.content)
    const reasons: DebateTerminationReason[] = ['converged', 'stagnated', 'budget_exhausted', 'degraded']
    const terminationReason = hasNextRound ? null : v.parseFailed ? 'degraded'
      : reasons.includes(v.terminationReason) ? v.terminationReason as DebateTerminationReason : null
    return {
      converged: !hasNextRound && !v.parseFailed && (terminationReason ? terminationReason === 'converged' : v.converged === true),
      disagreements: Array.isArray(v.disagreements) ? v.disagreements.map(String) : [],
      summary: typeof v.summary === 'string' ? v.summary : '',
      continuing: hasNextRound,
      terminationReason
    }
  } catch { return null }
}
