import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from './schema'

const SEEDED_DEFAULTS: [string, string][] = [
  ['openai_model', 'gpt-4o'],
  ['anthropic_model', 'claude-sonnet-4-5-20250514'],
  ['google_model', 'gemini-pro-latest'],
  ['ollama_base_url', 'http://localhost:11434'],
  ['synthesizer', 'anthropic'],
  ['enableDebate', 'true'],
  ['maxDebateRounds', '3'],
  ['globalShortcut', 'CommandOrControl+Shift+Space'],
  ['submitKey', 'CmdEnter'],
  ['systemPrompt', ''],
  ['setupComplete', 'false']
]

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string
    }[]
  ).map((r) => r.name)
}

function indexNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as {
      name: string
    }[]
  ).map((r) => r.name)
}

function addSession(db: Database.Database, id: string, title: string, repoId?: string): void {
  db.prepare('INSERT INTO sessions (id, title, repo_id) VALUES (?, ?, ?)').run(
    id,
    title,
    repoId ?? null
  )
}

function addMessage(
  db: Database.Database,
  id: string,
  sessionId: string,
  role: string,
  content: string
): void {
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
    id,
    sessionId,
    role,
    content
  )
}

function ftsRowids(db: Database.Database, term: string): number[] {
  return (
    db
      .prepare('SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?')
      .all(`"${term}"`) as { rowid: number }[]
  ).map((r) => r.rowid)
}

describe('runMigrations on a fresh database', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('creates all expected tables including FTS virtual tables', () => {
    const tables = tableNames(db)
    for (const expected of [
      'sessions',
      'messages',
      'settings',
      'indexed_repos',
      'repo_files',
      'attachments',
      'mcp_servers',
      'messages_fts',
      'repo_files_fts'
    ]) {
      expect(tables).toContain(expected)
    }
  })

  it('creates the expected indexes', () => {
    const indexes = indexNames(db)
    for (const expected of [
      'idx_attachments_message',
      'idx_messages_session',
      'idx_sessions_updated',
      'idx_repo_files_repo'
    ]) {
      expect(indexes).toContain(expected)
    }
  })

  it('is idempotent: a second run throws nothing and leaves schema and data intact', () => {
    const tablesBefore = tableNames(db)
    const indexesBefore = indexNames(db)
    addSession(db, 's1', 'Kept chat')
    addMessage(db, 'm1', 's1', 'user', 'hello again')

    expect(() => runMigrations(db)).not.toThrow()

    expect(tableNames(db)).toEqual(tablesBefore)
    expect(indexNames(db)).toEqual(indexesBefore)
    const row = db.prepare('SELECT content FROM messages WHERE id = ?').get('m1') as {
      content: string
    }
    expect(row.content).toBe('hello again')
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({
      n: SEEDED_DEFAULTS.length
    })
  })

  it('seeds the default settings', () => {
    for (const [key, value] of SEEDED_DEFAULTS) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined
      expect(row, `settings key ${key}`).toBeDefined()
      expect(row?.value).toBe(value)
    }
  })

  it('preserves user-modified settings on re-run and re-seeds deleted keys', () => {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('true', 'setupComplete')
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('gpt-5', 'openai_model')
    db.prepare('DELETE FROM settings WHERE key = ?').run('synthesizer')

    runMigrations(db)

    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('setupComplete')).toEqual({
      value: 'true'
    })
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('openai_model')).toEqual({
      value: 'gpt-5'
    })
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('synthesizer')).toEqual({
      value: 'anthropic'
    })
  })

  it('rejects invalid message roles via the CHECK constraint', () => {
    addSession(db, 's1', 'Chat')
    expect(() => addMessage(db, 'm1', 's1', 'system', 'nope')).toThrow(/CHECK constraint failed/)
    // every allowed role passes
    for (const [i, role] of ['user', 'agent', 'debate', 'moderator', 'synthesis'].entries()) {
      expect(() => addMessage(db, `ok${i}`, 's1', role, 'fine')).not.toThrow()
    }
  })
})

describe('messages FTS triggers', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    addSession(db, 's1', 'Chat')
  })

  afterEach(() => {
    db.close()
  })

  it('indexes inserted messages so MATCH finds them', () => {
    addMessage(db, 'm1', 's1', 'user', 'the quantum walrus speaks')
    const rowid = (
      db.prepare('SELECT rowid FROM messages WHERE id = ?').get('m1') as { rowid: number }
    ).rowid
    expect(ftsRowids(db, 'walrus')).toEqual([rowid])
  })

  it('re-indexes updated messages', () => {
    addMessage(db, 'm1', 's1', 'user', 'original zebra content')
    db.prepare('UPDATE messages SET content = ? WHERE id = ?').run('replacement giraffe text', 'm1')

    expect(ftsRowids(db, 'zebra')).toEqual([])
    expect(ftsRowids(db, 'giraffe')).toHaveLength(1)
  })

  it('removes deleted messages from the index', () => {
    addMessage(db, 'm1', 's1', 'user', 'ephemeral flamingo note')
    db.prepare('DELETE FROM messages WHERE id = ?').run('m1')
    expect(ftsRowids(db, 'flamingo')).toEqual([])
  })

  it('keeps repo_files_fts in sync on insert and delete', () => {
    db.prepare(
      'INSERT INTO indexed_repos (id, github_id, full_name, local_path) VALUES (?, ?, ?, ?)'
    ).run('r1', 42, 'acme/widgets', '/tmp/widgets')
    db.prepare('INSERT INTO repo_files (repo_id, path, content) VALUES (?, ?, ?)').run(
      'r1',
      'src/lib/anchovy.ts',
      'export const anchovy = true'
    )

    const hits = db
      .prepare('SELECT rowid FROM repo_files_fts WHERE repo_files_fts MATCH ?')
      .all('"anchovy"')
    expect(hits).toHaveLength(1)

    db.prepare('DELETE FROM repo_files WHERE repo_id = ?').run('r1')
    expect(
      db.prepare('SELECT rowid FROM repo_files_fts WHERE repo_files_fts MATCH ?').all('"anchovy"')
    ).toEqual([])
  })
})

describe('legacy upgrade: pre-round messages table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // Oldest shape: sessions without repo_id; messages without round/agent_id/
    // provider and without 'moderator' in the role CHECK.
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Session',
        starred INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'agent', 'debate', 'synthesis')),
        agent_name TEXT,
        content TEXT NOT NULL,
        token_count INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `)
    db.prepare("INSERT INTO sessions (id, title) VALUES ('s1', 'Legacy chat')").run()
    const insert = db.prepare(
      `INSERT INTO messages (rowid, id, session_id, role, agent_name, content, token_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(3, 'm-user', 's1', 'user', null, 'what is the capital of assyria', 12)
    insert.run(7, 'm-agent', 's1', 'agent', 'openai', 'a nineveh themed answer', 34)
    insert.run(11, 'm-debate', 's1', 'debate', 'anthropic', 'debate rebuttal text', 56)
    insert.run(20, 'm-synth', 's1', 'synthesis', 'google', 'final synthesis text', 78)

    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('backfills round: debate rows get 1, all others 0', () => {
    const rows = db.prepare('SELECT id, round FROM messages ORDER BY rowid').all() as {
      id: string
      round: number
    }[]
    expect(rows).toEqual([
      { id: 'm-user', round: 0 },
      { id: 'm-agent', round: 0 },
      { id: 'm-debate', round: 1 },
      { id: 'm-synth', round: 0 }
    ])
  })

  it('preserves rowids through the table rebuild', () => {
    const rows = db.prepare('SELECT rowid, id FROM messages ORDER BY rowid').all() as {
      rowid: number
      id: string
    }[]
    expect(rows).toEqual([
      { rowid: 3, id: 'm-user' },
      { rowid: 7, id: 'm-agent' },
      { rowid: 11, id: 'm-debate' },
      { rowid: 20, id: 'm-synth' }
    ])
  })

  it('adds agent_id and provider columns; provider stays NULL on this path (rebuild pre-adds the columns, skipping the backfill)', () => {
    const cols = (db.pragma('table_info(messages)') as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('agent_id')
    expect(cols).toContain('provider')

    // Current behavior: migrateMessagesTable creates the new table with
    // agent_id/provider already present, so the later "add columns + backfill
    // provider from agent_name" branch never fires for pre-round DBs, even for
    // rows whose agent_name is a provider name. (Suspected bug — see report.)
    const rows = db
      .prepare('SELECT agent_name, agent_id, provider FROM messages ORDER BY rowid')
      .all() as { agent_name: string | null; agent_id: string | null; provider: string | null }[]
    expect(rows.map((r) => r.agent_name)).toEqual([null, 'openai', 'anthropic', 'google'])
    expect(rows.every((r) => r.agent_id === null)).toBe(true)
    expect(rows.every((r) => r.provider === null)).toBe(true)
  })

  it('adds the repo_id column to the legacy sessions table', () => {
    const cols = (db.pragma('table_info(sessions)') as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('repo_id')
  })

  it('widens the role CHECK so moderator rows are accepted after migration', () => {
    expect(() => addMessage(db, 'm-mod', 's1', 'moderator', 'moderator ruling')).not.toThrow()
  })

  it('rebuilds the FTS index over legacy rows and recreates the triggers', () => {
    // legacy content is searchable after the rebuild
    expect(ftsRowids(db, 'nineveh')).toEqual([7])
    // recreated triggers index new writes
    addMessage(db, 'm-new', 's1', 'user', 'freshly inserted okapi')
    expect(ftsRowids(db, 'okapi')).toHaveLength(1)
    // ...and un-index deletes
    db.prepare('DELETE FROM messages WHERE id = ?').run('m-new')
    expect(ftsRowids(db, 'okapi')).toEqual([])
  })

  it('leaves foreign key enforcement switched back on', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(() => addMessage(db, 'm-orphan', 'no-such-session', 'user', 'dangling')).toThrow(
      /FOREIGN KEY constraint failed/
    )
  })
})

describe('legacy upgrade: round present but no agent_id/provider', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Session',
        starred INTEGER NOT NULL DEFAULT 0,
        repo_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'agent', 'debate', 'moderator', 'synthesis')),
        agent_name TEXT,
        content TEXT NOT NULL,
        token_count INTEGER,
        round INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      -- Any DB that ever ran runMigrations has messages_fts and its triggers
      -- (their creation has always been unconditional). The agent_id backfill
      -- UPDATE fires messages_au, which issues FTS 'delete' commands; those
      -- corrupt an external-content index whose rows were never inserted, so
      -- the realistic legacy shape must include a populated index.
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=rowid
      );

      CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `)
    db.prepare("INSERT INTO sessions (id, title) VALUES ('s1', 'Mid-era chat')").run()
    const insert = db.prepare(
      'INSERT INTO messages (id, session_id, role, agent_name, content) VALUES (?, ?, ?, ?, ?)'
    )
    insert.run('m-openai', 's1', 'agent', 'openai', 'answer one')
    insert.run('m-anthropic', 's1', 'agent', 'anthropic', 'answer two')
    insert.run('m-google', 's1', 'agent', 'google', 'answer three')
    insert.run('m-display', 's1', 'agent', 'GPT-4 Turbo', 'answer four')
    insert.run('m-none', 's1', 'user', null, 'a question')

    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('adds the columns and backfills provider only from known provider names', () => {
    const rows = db
      .prepare('SELECT id, agent_name, agent_id, provider FROM messages ORDER BY id')
      .all() as {
      id: string
      agent_name: string | null
      agent_id: string | null
      provider: string | null
    }[]

    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(byId['m-openai'].provider).toBe('openai')
    expect(byId['m-anthropic'].provider).toBe('anthropic')
    expect(byId['m-google'].provider).toBe('google')
    expect(byId['m-display'].provider).toBeNull()
    expect(byId['m-none'].provider).toBeNull()

    // agent_name is untouched and agent_id is never backfilled
    expect(byId['m-openai'].agent_name).toBe('openai')
    expect(rows.every((r) => r.agent_id === null)).toBe(true)
  })
})

describe('maintenance rewrites on every run', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('deletes orphaned empty New Session rows but keeps titled, repo-linked, and non-empty ones', () => {
    addSession(db, 'orphan', 'New Session')
    addSession(db, 'titled', 'Renamed but empty')
    addSession(db, 'repo-linked', 'New Session', 'some-repo')
    addSession(db, 'has-msgs', 'New Session')
    addMessage(db, 'm1', 'has-msgs', 'user', 'keep me')

    runMigrations(db)

    const ids = (db.prepare('SELECT id FROM sessions ORDER BY id').all() as { id: string }[]).map(
      (r) => r.id
    )
    expect(ids).toEqual(['has-msgs', 'repo-linked', 'titled'])
  })

  it('rewrites the retired gemini-1.5-pro default to gemini-pro-latest, leaving other values alone', () => {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('gemini-1.5-pro', 'google_model')
    runMigrations(db)
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('google_model')).toEqual({
      value: 'gemini-pro-latest'
    })

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      'gemini-2.0-flash',
      'google_model'
    )
    runMigrations(db)
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('google_model')).toEqual({
      value: 'gemini-2.0-flash'
    })
  })

  it('rewrites the linear preset SSE endpoint to the streamable-HTTP one, only for source=linear', () => {
    const insert = db.prepare(
      'INSERT INTO mcp_servers (id, name, transport, source) VALUES (?, ?, ?, ?)'
    )
    insert.run(
      'linear-1',
      'Linear',
      '{"type":"sse","url":"https://mcp.linear.app/sse"}',
      'linear'
    )
    insert.run(
      'custom-1',
      'My server',
      '{"type":"sse","url":"https://mcp.linear.app/sse"}',
      'custom'
    )

    runMigrations(db)

    expect(
      db.prepare('SELECT transport FROM mcp_servers WHERE id = ?').get('linear-1')
    ).toEqual({ transport: '{"type":"sse","url":"https://mcp.linear.app/mcp"}' })
    expect(
      db.prepare('SELECT transport FROM mcp_servers WHERE id = ?').get('custom-1')
    ).toEqual({ transport: '{"type":"sse","url":"https://mcp.linear.app/sse"}' })
  })
})
