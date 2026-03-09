import { ipcMain } from 'electron'
import { getDb } from '../db'
import { v4 as uuidv4 } from 'uuid'
import type { Session, Message } from '../../shared/types'

export function registerSessionsHandlers(): void {
  ipcMain.handle('sessions:list', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Session[]
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
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  })

  ipcMain.handle('sessions:search', (_, query: string) => {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT DISTINCT s.* FROM sessions s
         JOIN messages m ON m.session_id = s.id
         JOIN messages_fts fts ON fts.rowid = m.rowid
         WHERE messages_fts MATCH ?
         ORDER BY s.updated_at DESC`
      )
      .all(query) as Session[]
    return rows
  })

  ipcMain.handle('messages:list', (_, sessionId: string) => {
    const db = getDb()
    return db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as Message[]
  })

  ipcMain.handle('messages:add', (_, message: Omit<Message, 'id' | 'created_at'>) => {
    const db = getDb()
    const id = uuidv4()
    db.prepare(
      'INSERT INTO messages (id, session_id, role, agent_name, content, token_count) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, message.session_id, message.role, message.agent_name, message.content, message.token_count)
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

      if (format === 'json') {
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
                ? `${msg.agent_name} (Debate)`
                : msg.agent_name || 'Agent'

        md += `### ${label}\n\n${msg.content}\n\n---\n\n`
      }

      return md
    }
  )
}
