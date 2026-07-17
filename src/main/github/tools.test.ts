import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectAndFetchToolsByFullName,
  detectRepoFromPrompt,
  fetchRecentPRs,
  formatToolResults
} from './tools'
import { getDb } from '../db'
import { getApiKey } from '../keychain'
import { runMigrations } from '../db/schema'

vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../keychain', () => ({
  getApiKey: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  findCredentialAccounts: vi.fn()
}))

const getDbMock = vi.mocked(getDb)
const getApiKeyMock = vi.mocked(getApiKey)
const fetchMock = vi.fn()

let db: Database.Database

function insertRepo(id: string, fullName: string): void {
  db.prepare(
    'INSERT INTO indexed_repos (id, github_id, full_name, local_path) VALUES (?, ?, ?, ?)'
  ).run(id, 1, fullName, '/tmp/repo')
}

// Routes are matched in order by substring — list the most specific first
function respondWith(routes: [fragment: string, body: unknown][]): void {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input)
    const hit = routes.find(([fragment]) => url.includes(fragment))
    if (!hit) throw new Error(`Unexpected fetch: ${url}`)
    return new Response(JSON.stringify(hit[1]), { status: 200 })
  })
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]))
}

interface PRFixture {
  number: number
  title: string
  state: string
  user: { login: string }
  created_at: string
  merged_at: string | null
  body: string | null
  additions: number
  deletions: number
  changed_files: number
  head: { ref: string }
  base: { ref: string }
}

function pr(overrides: Partial<PRFixture> = {}): PRFixture {
  return {
    number: 1,
    title: 'Add feature',
    state: 'open',
    user: { login: 'alice' },
    created_at: '2026-01-01T00:00:00Z',
    merged_at: null,
    body: null,
    additions: 10,
    deletions: 2,
    changed_files: 3,
    head: { ref: 'feat' },
    base: { ref: 'main' },
    ...overrides
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  getDbMock.mockReturnValue(db)
  getApiKeyMock.mockResolvedValue('gh-test-token')
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  db.close()
})

describe('detectRepoFromPrompt', () => {
  it('returns an explicit owner/repo with a null id when not indexed', () => {
    expect(detectRepoFromPrompt('what changed in facebook/react lately?')).toEqual({
      fullName: 'facebook/react',
      indexedRepoId: null
    })
  })

  it('attaches the indexed repo id when an explicit owner/repo is indexed', () => {
    insertRepo('repo-1', 'acme/widgets')
    expect(detectRepoFromPrompt('summarize acme/widgets for me')).toEqual({
      fullName: 'acme/widgets',
      indexedRepoId: 'repo-1'
    })
  })

  it('matches an indexed repo by short name, case-insensitively', () => {
    insertRepo('repo-1', 'acme/Widgets')
    expect(detectRepoFromPrompt('any open bugs in WIDGETS right now?')).toEqual({
      fullName: 'acme/Widgets',
      indexedRepoId: 'repo-1'
    })
  })

  it('prefers an explicit owner/repo pattern over an indexed short-name match', () => {
    insertRepo('repo-1', 'acme/widgets')
    expect(detectRepoFromPrompt('compare foo/bar against widgets')).toEqual({
      fullName: 'foo/bar',
      indexedRepoId: null
    })
  })

  it('returns null when nothing matches', () => {
    insertRepo('repo-1', 'acme/widgets')
    expect(detectRepoFromPrompt('what changed recently?')).toBeNull()
  })
})

describe('formatToolResults', () => {
  it('returns an empty string for no results', () => {
    expect(formatToolResults([])).toBe('')
  })

  it('renders title-cased labels under the Live GitHub Data header', () => {
    const out = formatToolResults([
      { tool: 'pull_requests', data: 'PR DATA' },
      { tool: 'repo_overview', data: 'OVERVIEW DATA' }
    ])

    expect(out.startsWith('\n## Live GitHub Data\n\n')).toBe(true)
    expect(out).toContain('### Pull Requests\n\nPR DATA\n\n')
    expect(out).toContain('### Repo Overview\n\nOVERVIEW DATA\n\n')
    expect(out.indexOf('### Pull Requests')).toBeLessThan(out.indexOf('### Repo Overview'))
  })
})

describe('detectAndFetchToolsByFullName', () => {
  it.each(['no-slash-here', 'owner/', '/repo', ''])(
    'returns [] for malformed fullName %j',
    async (fullName) => {
      await expect(detectAndFetchToolsByFullName(fullName, 'show me PRs')).resolves.toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('routes PR keywords to pull_requests with a default of 5', async () => {
    respondWith([['/pulls?state=all', []]])
    const results = await detectAndFetchToolsByFullName('o/r', 'show me the recent pull requests')

    expect(results).toEqual([{ tool: 'pull_requests', data: 'No pull requests found.' }])
    expect(calledUrls()[0]).toBe(
      'https://api.github.com/repos/o/r/pulls?state=all&sort=created&direction=desc&per_page=5'
    )
  })

  it('routes commit keywords to commits with a default of 10', async () => {
    respondWith([['/commits', []]])
    const results = await detectAndFetchToolsByFullName('o/r', 'summarize the commit history')

    expect(results).toEqual([{ tool: 'commits', data: 'No commits found.' }])
    expect(calledUrls()[0]).toBe('https://api.github.com/repos/o/r/commits?per_page=10')
  })

  it('routes bug/issue keywords to issues with a default of 10', async () => {
    respondWith([['/issues', []]])
    const results = await detectAndFetchToolsByFullName('o/r', 'any known bugs?')

    expect(results).toEqual([{ tool: 'issues', data: 'No issues found.' }])
    expect(calledUrls()[0]).toBe(
      'https://api.github.com/repos/o/r/issues?state=all&sort=created&direction=desc&per_page=10'
    )
  })

  it('routes branch keywords to branches and formats the list', async () => {
    respondWith([
      [
        '/branches',
        [
          { name: 'main', protected: true },
          { name: 'dev', protected: false }
        ]
      ]
    ])
    const results = await detectAndFetchToolsByFullName('o/r', 'list the branches')

    expect(results).toEqual([{ tool: 'branches', data: '- `main` (protected)\n- `dev`' }])
  })

  it('routes contributor keywords to contributors', async () => {
    respondWith([['/contributors', [{ login: 'alice', contributions: 42 }]]])
    const results = await detectAndFetchToolsByFullName('o/r', 'list the contributors')

    expect(results).toEqual([{ tool: 'contributors', data: '- **alice**: 42 commits' }])
  })

  // The "who contribut" branch of the contributors pattern is followed by \b,
  // so "who contributed"/"who contributes" never match it — only the literal
  // truncated token "who contribut" would. Captured as current behavior.
  it('does not match "who contributed" against the contributors pattern', async () => {
    const results = await detectAndFetchToolsByFullName('o/r', 'who contributed the most?')
    expect(results).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes overview keywords to repo_overview', async () => {
    respondWith([
      [
        'repos/o/r',
        {
          full_name: 'o/r',
          description: 'A test repo',
          language: 'TypeScript',
          stargazers_count: 1,
          forks_count: 2,
          open_issues_count: 3,
          default_branch: 'main',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
          topics: [],
          license: null
        }
      ]
    ])
    const results = await detectAndFetchToolsByFullName('o/r', 'give me an overview')

    expect(results).toHaveLength(1)
    expect(results[0].tool).toBe('repo_overview')
    expect(results[0].data).toContain('# o/r')
    expect(results[0].data).toContain('- **Stars:** 1 | **Forks:** 2')
  })

  it('extracts an explicit count ("last 7 PRs")', async () => {
    respondWith([['/pulls?state=all', []]])
    await detectAndFetchToolsByFullName('o/r', 'show the last 7 PRs')
    expect(calledUrls()[0]).toContain('per_page=7')
  })

  it('caps requested counts per tool (PRs at 10, commits at 20, issues at 15)', async () => {
    respondWith([['/pulls?state=all', []]])
    await detectAndFetchToolsByFullName('o/r', 'show the last 50 PRs')
    expect(calledUrls()[0]).toContain('per_page=10')

    fetchMock.mockClear()
    respondWith([['/commits', []]])
    await detectAndFetchToolsByFullName('o/r', 'show the latest 25 commits')
    expect(calledUrls()[0]).toContain('per_page=20')

    fetchMock.mockClear()
    respondWith([['/issues', []]])
    await detectAndFetchToolsByFullName('o/r', 'show the top 20 issues')
    expect(calledUrls()[0]).toContain('per_page=15')
  })

  it('fetches each tool at most once and returns tools in pattern order', async () => {
    respondWith([
      ['/commits', []],
      ['/issues', []]
    ])
    const results = await detectAndFetchToolsByFullName(
      'o/r',
      'walk through the recent commits, commit history, and open issues'
    )

    expect(results.map((r) => r.tool)).toEqual(['commits', 'issues'])
    expect(calledUrls().filter((u) => u.includes('/commits'))).toHaveLength(1)
  })

  it('converts a rejecting handler into an "Error fetching" entry instead of throwing', async () => {
    fetchMock.mockResolvedValue(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    )
    const results = await detectAndFetchToolsByFullName('o/r', 'recent commits please')

    expect(results).toEqual([
      { tool: 'commits', data: 'Error fetching commits: GitHub API 500: Internal Server Error' }
    ])
  })

  it('reports a missing GitHub token as an error entry', async () => {
    getApiKeyMock.mockResolvedValue(null)
    const results = await detectAndFetchToolsByFullName('o/r', 'recent PRs')

    expect(results).toEqual([
      { tool: 'pull_requests', data: 'Error fetching pull_requests: No GitHub token configured' }
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchRecentPRs', () => {
  it('returns the empty message when there are no PRs', async () => {
    respondWith([['/pulls?state=all', []]])
    await expect(fetchRecentPRs('o', 'r')).resolves.toBe('No pull requests found.')
  })

  it('throws a GitHub API error on a non-ok response', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }))
    await expect(fetchRecentPRs('o', 'r')).rejects.toThrow('GitHub API 404: Not Found')
  })

  it('renders PR metadata and truncates bodies over 1000 characters', async () => {
    const body = 'x'.repeat(1200)
    respondWith([
      ['/pulls/1/files', []],
      ['/pulls/1/reviews', []],
      ['/pulls?state=all', [pr({ state: 'closed', merged_at: '2026-01-02T00:00:00Z', body })]]
    ])

    const out = await fetchRecentPRs('o', 'r')
    expect(out).toContain('## PR #1: Add feature')
    expect(out).toContain('- **State:** closed (merged)')
    expect(out).toContain('- **Branch:** feat → main')
    expect(out).toContain('- **Changes:** +10 -2 across 3 files')
    expect(out).toContain('x'.repeat(1000) + '...')
    expect(out).not.toContain('x'.repeat(1001))
  })

  it('lists at most 20 changed files and elides the rest', async () => {
    const files = Array.from({ length: 23 }, (_, i) => ({
      filename: `f${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0
    }))
    respondWith([
      ['/pulls/1/files', files],
      ['/pulls/1/reviews', []],
      ['/pulls?state=all', [pr()]]
    ])

    const out = await fetchRecentPRs('o', 'r')
    expect(out).toContain('- `f19.ts` (modified, +1 -0)')
    expect(out).not.toContain('`f20.ts`')
    expect(out).toContain('- ... and 3 more files')
  })

  it('includes at most 5 patches, skipping patches of 2000+ characters', async () => {
    const small = (i: number): { filename: string; status: string; additions: number; deletions: number; patch: string } => ({
      filename: `f${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: `+small-${i}`
    })
    const files = [
      small(0),
      small(1),
      { ...small(2), patch: 'y'.repeat(2100) }, // filtered out before the slice
      small(3),
      small(4),
      small(5),
      small(6) // sixth remaining small patch — dropped by the 5-patch cap
    ]
    respondWith([
      ['/pulls/1/files', files],
      ['/pulls/1/reviews', []],
      ['/pulls?state=all', [pr()]]
    ])

    const out = await fetchRecentPRs('o', 'r')
    expect(out).toContain('### Key Diffs')
    for (const i of [0, 1, 3, 4, 5]) {
      expect(out).toContain(`#### f${i}.ts`)
    }
    expect(out).not.toContain('#### f2.ts')
    expect(out).not.toContain('#### f6.ts')
    expect(out).not.toContain('y'.repeat(2100))
  })

  it('shows at most 5 reviews with bodies, truncated to 300 characters', async () => {
    const reviews = Array.from({ length: 6 }, (_, i) => ({
      user: { login: `rev${i}` },
      state: 'APPROVED',
      body: i === 0 ? 'r'.repeat(350) : `looks good ${i}`,
      submitted_at: '2026-01-01T00:00:00Z'
    }))
    reviews.push({
      user: { login: 'silent' },
      state: 'APPROVED',
      body: null as unknown as string,
      submitted_at: '2026-01-01T00:00:00Z'
    })
    respondWith([
      ['/pulls/1/files', []],
      ['/pulls/1/reviews', reviews],
      ['/pulls?state=all', [pr()]]
    ])

    const out = await fetchRecentPRs('o', 'r')
    expect(out).toContain('### Reviews')
    expect(out).toContain('- **rev0** (APPROVED): ' + 'r'.repeat(300) + '...')
    expect(out).toContain('- **rev4**')
    expect(out).not.toContain('- **rev5**')
    expect(out).not.toContain('- **silent**')
  })
})
