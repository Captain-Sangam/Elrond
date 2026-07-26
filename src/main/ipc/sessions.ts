import { ipcMain } from 'electron'
import { getDb } from '../db'
import { toFtsQuery } from '../db/fts'
import { deleteAttachmentFiles, loadAttachmentsForMessages } from '../attachments'
import { v4 as uuidv4 } from 'uuid'
import type { Session, Message, TurnStats } from '../../shared/types'

export function registerSessionsHandlers(): void {
  ipcMain.handle('sessions:list', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Session[]
  })

  ipcMain.handle('stats:lifetime', () => {
    const db = getDb()
    const row = db
      .prepare(
        "SELECT COUNT(CASE WHEN role = 'user' THEN 1 END) AS turns, COALESCE(SUM(CASE WHEN role != 'user' THEN token_count END), 0) AS tokensGenerated FROM messages"
      )
      .get() as { turns: number; tokensGenerated: number }
    return row
  })

  ipcMain.handle('turnStats:list', (_, sessionId: string) => {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM turn_stats WHERE session_id = ? ORDER BY turn')
      .all(sessionId) as {
      turn: number
      input: number
      output: number
      cost: number
      elapsed_ms: number
      rounds: number
      converged: number | null
    }[]
    return rows.map((r) => ({
      turn: r.turn,
      input: r.input,
      output: r.output,
      cost: r.cost,
      elapsedMs: r.elapsed_ms,
      rounds: r.rounds,
      // NULL means "debate off / no verdict" and must stay null, not become false
      converged: r.converged === null ? null : r.converged === 1
    })) satisfies TurnStats[]
  })

  // Idempotent: the archive path and the completion path can both write the
  // same turn, so re-saving must overwrite rather than fail on the PK
  ipcMain.handle('turnStats:save', (_, sessionId: string, stats: TurnStats) => {
    const db = getDb()
    db.prepare(
      `INSERT OR REPLACE INTO turn_stats
         (session_id, turn, input, output, cost, elapsed_ms, rounds, converged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      stats.turn,
      stats.input,
      stats.output,
      stats.cost,
      stats.elapsedMs,
      stats.rounds,
      stats.converged === null ? null : stats.converged ? 1 : 0
    )
  })

  ipcMain.handle('sessions:get', (_, id: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined
  })

  ipcMain.handle('sessions:create', (_, title?: string) => {
    const db = getDb()
    const id = uuidv4()
    const sessionTitle = title || 'New Session'
    db.prepare('INSERT INTO sessions (id, title) VALUES (?, ?)').run(id, sessionTitle)
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session
  })

  ipcMain.handle(
    'sessions:update',
    (_, id: string, updates: Partial<Pick<Session, 'title' | 'starred'>>) => {
      const db = getDb()
      if (updates.title !== undefined) {
        db.prepare('UPDATE sessions SET title = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
          updates.title,
          id
        )
      }
      if (updates.starred !== undefined) {
        db.prepare('UPDATE sessions SET starred = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
          updates.starred ? 1 : 0,
          id
        )
      }
    }
  )

  ipcMain.handle('sessions:delete', (_, id: string) => {
    const db = getDb()
    deleteAttachmentFiles(id)
    db.prepare(
      'DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)'
    ).run(id)
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  })

  ipcMain.handle('sessions:search', (_, query: string) => {
    const db = getDb()
    const ftsQuery = toFtsQuery(query, 'all')
    if (!ftsQuery) return []
    try {
      return db
        .prepare(
          `SELECT DISTINCT s.* FROM sessions s
           JOIN messages m ON m.session_id = s.id
           JOIN messages_fts fts ON fts.rowid = m.rowid
           WHERE messages_fts MATCH ?
           ORDER BY s.updated_at DESC`
        )
        .all(ftsQuery) as Session[]
    } catch {
      return []
    }
  })

  ipcMain.handle('messages:list', (_, sessionId: string) => {
    const db = getDb()
    const messages = db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as Message[]

    const attachments = loadAttachmentsForMessages(
      messages.filter((m) => m.role === 'user').map((m) => m.id)
    )
    for (const msg of messages) {
      const list = attachments.get(msg.id)
      if (list) msg.attachments = list
    }
    return messages
  })

  ipcMain.handle('messages:add', (_, message: Omit<Message, 'id' | 'created_at'>) => {
    const db = getDb()
    const id = uuidv4()
    db.prepare(
      'INSERT INTO messages (id, session_id, role, agent_name, agent_id, provider, content, token_count, round) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      message.session_id,
      message.role,
      message.agent_name,
      message.agent_id ?? null,
      message.provider ?? null,
      message.content,
      message.token_count,
      message.round ?? 0
    )
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message
  })

  ipcMain.handle(
    'sessions:export',
    (_, sessionId: string, format: 'markdown' | 'json') => {
      const db = getDb()
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
        | Session
        | undefined
      if (!session) throw new Error('Session not found')

      const messages = db
        .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
        .all(sessionId) as Message[]

      const exportAttachments = loadAttachmentsForMessages(
        messages.filter((m) => m.role === 'user').map((m) => m.id)
      )

      if (format === 'json') {
        for (const msg of messages) {
          const list = exportAttachments.get(msg.id)
          if (list) msg.attachments = list
        }
        return JSON.stringify({ session, messages }, null, 2)
      }

      let md = `# ${session.title}\n\n`
      md += `*Created: ${session.created_at}*\n\n---\n\n`

      for (const msg of messages) {
        const label =
          msg.role === 'user'
            ? 'You'
            : msg.role === 'synthesis'
              ? 'Synthesis'
              : msg.role === 'debate'
                ? `${msg.agent_name} (Debate Round ${msg.round || 1})`
                : msg.role === 'moderator'
                  ? `Moderator (Round ${msg.round || 1})`
                  : msg.agent_name || 'Agent'

        md += `### ${label}\n\n${msg.content}\n\n`
        const list = exportAttachments.get(msg.id)
        if (list && list.length > 0) {
          md += `*Attachments: ${list.map((a) => a.file_name).join(', ')}*\n\n`
        }
        md += `---\n\n`
      }

      return md
    }
  )
}
