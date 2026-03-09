import type Database from 'better-sqlite3'

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Session',
      starred INTEGER NOT NULL DEFAULT 0,
      repo_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'agent', 'debate', 'synthesis')),
      agent_name TEXT,
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indexed_repos (
      id TEXT PRIMARY KEY,
      github_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
      file_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS repo_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (repo_id) REFERENCES indexed_repos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_repo_files_repo ON repo_files(repo_id);
  `)

  // Add repo_id column if missing (migration for existing DBs)
  const sessionCols = db.pragma('table_info(sessions)') as { name: string }[]
  if (!sessionCols.some((c) => c.name === 'repo_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN repo_id TEXT')
  }

  const hasFts = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
    .get()

  if (!hasFts) {
    db.exec(`
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
  }

  const hasRepoFts = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repo_files_fts'")
    .get()

  if (!hasRepoFts) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS repo_files_fts USING fts5(
        path,
        content,
        content=repo_files,
        content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS repo_files_ai AFTER INSERT ON repo_files BEGIN
        INSERT INTO repo_files_fts(rowid, path, content) VALUES (new.id, new.path, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS repo_files_ad AFTER DELETE ON repo_files BEGIN
        INSERT INTO repo_files_fts(repo_files_fts, rowid, path, content) VALUES ('delete', old.id, old.path, old.content);
      END;
    `)
  }

  seedDefaults(db)
}

function seedDefaults(db: Database.Database): void {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')

  const defaults: [string, string][] = [
    ['openai_model', 'gpt-4o'],
    ['anthropic_model', 'claude-sonnet-4-5-20250514'],
    ['google_model', 'gemini-1.5-pro'],
    ['synthesizer', 'anthropic'],
    ['enableDebate', 'true'],
    ['globalShortcut', 'CommandOrControl+Shift+Space'],
    ['submitKey', 'CmdEnter'],
    ['systemPrompt', ''],
    ['setupComplete', 'false']
  ]

  const transaction = db.transaction(() => {
    for (const [key, value] of defaults) {
      insert.run(key, value)
    }
  })

  transaction()
}
