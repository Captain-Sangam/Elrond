import { describe, expect, it } from 'vitest'
import type { Message } from '@shared/types'
import { parseStoredVerdict } from './debateHistory'

const message = (value: unknown): Message => ({ id: 'm', session_id: 's', role: 'moderator', agent_name: null, agent_id: null, provider: null, content: JSON.stringify(value), token_count: 1, round: 1, created_at: '' })

describe('persisted debate verdicts', () => {
  it.each(['converged', 'stagnated', 'budget_exhausted', 'degraded'] as const)('retains the terminal outcome after reload: %s', (terminationReason) => {
    expect(parseStoredVerdict(message({ converged: true, disagreements: [], terminationReason }), false)).toMatchObject({ terminationReason, converged: terminationReason === 'converged', continuing: false })
  })
  it('keeps continuing rounds nonterminal and restores legacy moderator failures honestly', () => {
    expect(parseStoredVerdict(message({ converged: false, terminationReason: 'budget_exhausted' }), true)).toMatchObject({ terminationReason: null, continuing: true, converged: false })
    expect(parseStoredVerdict(message({ converged: true, parseFailed: true }), false)).toMatchObject({ terminationReason: 'degraded', converged: false })
  })
  it('handles malformed stored JSON and rejects unknown terminal labels', () => {
    expect(parseStoredVerdict(null, false)).toBeNull()
    expect(parseStoredVerdict({ ...message({}), content: 'broken' }, false)).toBeNull()
    expect(parseStoredVerdict(message({ terminationReason: 'constructor' }), false)?.terminationReason).toBeNull()
  })
})
