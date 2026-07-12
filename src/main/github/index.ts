import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, readdirSync, readFileSync, statSync, rmSync, existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getDb } from '../db'
import { getApiKey } from '../keychain'
import { v4 as uuidv4 } from 'uuid'
import type { GitHubRepo, IndexedRepo, IndexProgressEvent } from '../../shared/types'

const execFileAsync = promisify(execFile)

const REPOS_DIR = join(app.getPath('userData'), 'repos')

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.rs', '.go', '.java', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.swift', '.m', '.mm',
  '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.graphql',
  '.md', '.mdx', '.txt', '.rst',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.sql', '.prisma',
  '.env', '.gitignore', '.dockerignore',
  '.dockerfile', '.tf', '.hcl',
  'Makefile', 'Dockerfile', 'Gemfile', 'Rakefile',
  '.r', '.R', '.jl', '.lua', '.ex', '.exs', '.erl', '.zig', '.nim', '.dart'
])

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', 'env',
  'target', '.gradle', '.idea', '.vscode',
  'vendor', 'Pods', '.dart_tool',
  'coverage', '.nyc_output', '.turbo', '.cache'
])

const MAX_FILE_SIZE = 100_000

export async function testGitHubToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    })
    return res.ok
  } catch {
    return false
  }
}

export async function listGitHubRepos(): Promise<GitHubRepo[]> {
  const token = await getApiKey('github')
  if (!token) return []

  const db = getDb()
  const orgRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('githubOrg') as
    | { value: string }
    | undefined
  const org = orgRow?.value?.trim() || null

  const repos: GitHubRepo[] = []
  const seen = new Set<number>()

  type RawRepo = {
    id: number
    full_name: string
    name: string
    owner: { login: string }
    description: string | null
    language: string | null
    stargazers_count: number
    default_branch: string
    private: boolean
  }

  const pushRepos = (data: RawRepo[]): void => {
    for (const r of data) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      repos.push({
        id: r.id,
        full_name: r.full_name,
        name: r.name,
        owner: r.owner.login,
        description: r.description,
        language: r.language,
        stargazers_count: r.stargazers_count,
        default_branch: r.default_branch,
        private: r.private
      })
    }
  }

  // Fetch org repos first if org is configured
  if (org) {
    for (const orgName of org.split(',').map((o) => o.trim()).filter(Boolean)) {
      let page = 1
      while (page <= 5) {
        const res = await fetch(
          `https://api.github.com/orgs/${orgName}/repos?per_page=100&page=${page}&sort=updated`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
        )
        if (!res.ok) break
        const data = (await res.json()) as RawRepo[]
        if (data.length === 0) break
        pushRepos(data)
        page++
      }
    }
  }

  // Also fetch user's own repos
  let page = 1
  while (page <= 3) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    )
    if (!res.ok) break
    const data = (await res.json()) as RawRepo[]
    if (data.length === 0) break
    pushRepos(data)
    page++
  }

  return repos
}

function shouldIndexFile(filePath: string): boolean {
  const ext = filePath.includes('.') ? '.' + filePath.split('.').pop()! : filePath.split('/').pop()!
  return TEXT_EXTENSIONS.has(ext.toLowerCase()) || TEXT_EXTENSIONS.has(filePath.split('/').pop()!)
}

function walkDir(dir: string, basePath: string): { path: string; content: string; size: number }[] {
  const files: { path: string; content: string; size: number }[] = []

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    if (entry.startsWith('.') && entry !== '.env') continue

    const fullPath = join(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      files.push(...walkDir(fullPath, basePath))
    } else if (stat.isFile() && stat.size <= MAX_FILE_SIZE && shouldIndexFile(entry)) {
      try {
        const content = readFileSync(fullPath, 'utf-8')
        const relativePath = fullPath.replace(basePath + '/', '')
        files.push({ path: relativePath, content, size: stat.size })
      } catch {
        // skip binary / unreadable files
      }
    }
  }

  return files
}

function getLanguageFromPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
    rb: 'ruby', php: 'php', swift: 'swift', cs: 'csharp',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    html: 'html', css: 'css', scss: 'scss', vue: 'vue', svelte: 'svelte',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
    md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
    r: 'r', jl: 'julia', lua: 'lua', dart: 'dart', zig: 'zig'
  }
  return (ext && map[ext]) || null
}

// Settings tab and the chat "Index now" button can race on the same repo —
// dedupe so both callers share one run
const inFlightIndexes = new Map<number, Promise<IndexedRepo>>()

export function indexRepo(
  repo: GitHubRepo,
  onProgress: (progress: IndexProgressEvent) => void = () => {}
): Promise<IndexedRepo> {
  const inFlight = inFlightIndexes.get(repo.id)
  if (inFlight) return inFlight

  const run = doIndexRepo(repo, onProgress).finally(() => inFlightIndexes.delete(repo.id))
  inFlightIndexes.set(repo.id, run)
  return run
}

async function doIndexRepo(
  repo: GitHubRepo,
  onProgress: (progress: IndexProgressEvent) => void
): Promise<IndexedRepo> {
  const emit = (event: Omit<IndexProgressEvent, 'repoId' | 'fullName'>): void =>
    onProgress({ repoId: repo.id, fullName: repo.full_name, ...event })

  try {
    const db = getDb()
    const token = await getApiKey('github')
    if (!token) throw new Error('No GitHub token configured')

    mkdirSync(REPOS_DIR, { recursive: true })

    const repoDir = join(REPOS_DIR, repo.full_name.replace('/', '_'))

    // Clone or pull — execFile (not execSync) so the main process stays responsive
    emit({ stage: 'cloning' })
    if (existsSync(join(repoDir, '.git'))) {
      await execFileAsync('git', ['pull', '--ff-only'], { cwd: repoDir, timeout: 60_000 })
    } else {
      if (existsSync(repoDir)) rmSync(repoDir, { recursive: true })
      const cloneUrl = `https://${token}@github.com/${repo.full_name}.git`
      await execFileAsync('git', ['clone', '--depth', '1', cloneUrl, repoDir], { timeout: 120_000 })
    }

    // Remove old index if exists — but keep its id: sessions reference it
    // via sessions.repo_id, and a reindex must not orphan them
    const existing = db.prepare('SELECT id FROM indexed_repos WHERE github_id = ?').get(repo.id) as
      | { id: string }
      | undefined

    if (existing) {
      db.prepare('DELETE FROM repo_files WHERE repo_id = ?').run(existing.id)
      db.prepare('DELETE FROM indexed_repos WHERE id = ?').run(existing.id)
    }

    // Walk and index files
    emit({ stage: 'scanning' })
    await new Promise(setImmediate) // let the progress event flush before the sync walk
    const files = walkDir(repoDir, repoDir)
    const repoId = existing?.id ?? uuidv4()

    emit({ stage: 'storing' })
    await new Promise(setImmediate)

    db.prepare(
      'INSERT INTO indexed_repos (id, github_id, full_name, local_path, file_count) VALUES (?, ?, ?, ?, ?)'
    ).run(repoId, repo.id, repo.full_name, repoDir, files.length)

    const insertFile = db.prepare(
      'INSERT INTO repo_files (repo_id, path, content, language, size) VALUES (?, ?, ?, ?, ?)'
    )

    const batchInsert = db.transaction(() => {
      for (const file of files) {
        insertFile.run(repoId, file.path, file.content, getLanguageFromPath(file.path), file.size)
      }
    })
    batchInsert()

    emit({ stage: 'done', fileCount: files.length })

    return {
      id: repoId,
      github_id: repo.id,
      full_name: repo.full_name,
      local_path: repoDir,
      indexed_at: new Date().toISOString(),
      file_count: files.length
    }
  } catch (err) {
    emit({ stage: 'error', message: err instanceof Error ? err.message : 'Indexing failed' })
    throw err
  }
}

export function getIndexedRepos(): IndexedRepo[] {
  const db = getDb()
  return db.prepare('SELECT * FROM indexed_repos ORDER BY indexed_at DESC').all() as IndexedRepo[]
}

export function deleteIndexedRepo(repoId: string): void {
  const db = getDb()
  const repo = db.prepare('SELECT local_path FROM indexed_repos WHERE id = ?').get(repoId) as
    | { local_path: string }
    | undefined

  if (repo && existsSync(repo.local_path)) {
    rmSync(repo.local_path, { recursive: true, force: true })
  }

  db.prepare('DELETE FROM repo_files WHERE repo_id = ?').run(repoId)
  db.prepare('DELETE FROM indexed_repos WHERE id = ?').run(repoId)
}

export function searchRepoCode(
  repoId: string,
  query: string
): { path: string; content: string; score: number }[] {
  const db = getDb()

  // FTS search
  const ftsResults = db
    .prepare(
      `SELECT rf.path, rf.content, bm25(repo_files_fts) as score
       FROM repo_files_fts fts
       JOIN repo_files rf ON rf.id = fts.rowid
       WHERE rf.repo_id = ? AND repo_files_fts MATCH ?
       ORDER BY score
       LIMIT 15`
    )
    .all(repoId, query) as { path: string; content: string; score: number }[]

  if (ftsResults.length > 0) return ftsResults

  // Fallback: LIKE search on path and content
  return db
    .prepare(
      `SELECT path, content, 0 as score FROM repo_files
       WHERE repo_id = ? AND (path LIKE ? OR content LIKE ?)
       LIMIT 15`
    )
    .all(repoId, `%${query}%`, `%${query}%`) as { path: string; content: string; score: number }[]
}

export function getRepoContext(repoId: string, query: string, maxChars: number = 30000): string {
  const results = searchRepoCode(repoId, query)
  let context = ''
  let totalChars = 0

  for (const result of results) {
    const fileBlock = `\n### ${result.path}\n\`\`\`\n${result.content}\n\`\`\`\n`
    if (totalChars + fileBlock.length > maxChars) {
      const truncated = result.content.slice(0, maxChars - totalChars - result.path.length - 20)
      context += `\n### ${result.path}\n\`\`\`\n${truncated}\n...(truncated)\n\`\`\`\n`
      break
    }
    context += fileBlock
    totalChars += fileBlock.length
  }

  return context
}
