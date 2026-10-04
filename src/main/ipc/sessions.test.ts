import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../db/schema'
import type { TurnStats } from '../../shared/types'

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }))
let db: Database.Database
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) } }))
vi.mock('../db', () => ({ getDb: () => db }))
vi.mock('../attachments', () => ({ loadAttachmentsForMessages: () => new Map(), deleteAttachmentFiles: vi.fn() }))
import { registerSessionsHandlers } from './sessions'

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare("INSERT INTO sessions (id, title) VALUES ('test', 'Test')").run()
  handlers.clear()
  registerSessionsHandlers()
})
afterEach(() => db.close())

describe('session persistence contracts', () => {
  it.each(['converged', 'stagnated', 'budget_exhausted', 'degraded'] as const)('round-trips turn stats with an explicit outcome: %s', (terminationReason) => {
    const stats: TurnStats = { turn: 1, input: 100, output: 20, cost: 0.001, elapsedMs: 1000, rounds: 2, converged: terminationReason === 'converged', terminationReason }
    handlers.get('turnStats:save')!(null, 'test', stats)
    expect(handlers.get('turnStats:list')!(null, 'test')).toEqual([stats])
  })

  it('retains tool evidence and final outcome through message retrieval and JSON export', () => {
    const tool_results = JSON.stringify([{ callId: 'c', toolName: 'docs__lookup', serverName: 'Docs', argsJson: '{}', content: 'Retrieved evidence', isError: false }])
    const saved = handlers.get('messages:add')!(null, { session_id: 'test', role: 'agent', agent_name: 'Ada', agent_id: 'a', provider: 'openai', content: 'Answer', token_count: 10, round: 0, tool_results, termination_reason: 'degraded' })
    expect(handlers.get('messages:list')!(null, 'test')[0]).toEqual(saved)
    const exported = JSON.parse(handlers.get('sessions:export')!(null, 'test', 'json'))
    expect(exported.messages[0]).toMatchObject({ tool_results, termination_reason: 'degraded' })
  })
})
