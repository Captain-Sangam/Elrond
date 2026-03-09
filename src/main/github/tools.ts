import { getApiKey } from '../keychain'
import { getDb } from '../db'

interface GitHubHeaders {
  Authorization: string
  Accept: string
}

async function ghHeaders(): Promise<GitHubHeaders> {
  const token = await getApiKey('github')
  if (!token) throw new Error('No GitHub token configured')
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
}

async function ghFetch<T>(url: string): Promise<T> {
  const headers = await ghHeaders()
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`)
  return res.json() as Promise<T>
}

// --- Pull Requests ---

interface PRResponse {
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

interface PRFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

interface PRReview {
  user: { login: string }
  state: string
  body: string | null
  submitted_at: string
}

export async function fetchRecentPRs(owner: string, repo: string, count: number = 5): Promise<string> {
  const prs = await ghFetch<PRResponse[]>(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=created&direction=desc&per_page=${count}`
  )

  if (prs.length === 0) return 'No pull requests found.'

  const detailed = await Promise.all(
    prs.map(async (pr) => {
      const [files, reviews] = await Promise.all([
        ghFetch<PRFile[]>(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=50`),
        ghFetch<PRReview[]>(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/reviews`)
      ])

      let section = `## PR #${pr.number}: ${pr.title}\n`
      section += `- **Author:** ${pr.user.login}\n`
      section += `- **State:** ${pr.state}${pr.merged_at ? ' (merged)' : ''}\n`
      section += `- **Branch:** ${pr.head.ref} → ${pr.base.ref}\n`
      section += `- **Created:** ${pr.created_at}\n`
      section += `- **Changes:** +${pr.additions} -${pr.deletions} across ${pr.changed_files} files\n`

      if (pr.body) {
        section += `\n### Description\n${pr.body.slice(0, 1000)}${pr.body.length > 1000 ? '...' : ''}\n`
      }

      if (files.length > 0) {
        section += `\n### Files Changed\n`
        for (const f of files.slice(0, 20)) {
          section += `- \`${f.filename}\` (${f.status}, +${f.additions} -${f.deletions})\n`
        }
        if (files.length > 20) section += `- ... and ${files.length - 20} more files\n`
      }

      // Include patches for small diffs
      const patchFiles = files.filter((f) => f.patch && f.patch.length < 2000).slice(0, 5)
      if (patchFiles.length > 0) {
        section += `\n### Key Diffs\n`
        for (const f of patchFiles) {
          section += `\n#### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\`\n`
        }
      }

      if (reviews.length > 0) {
        const meaningful = reviews.filter((r) => r.body)
        if (meaningful.length > 0) {
          section += `\n### Reviews\n`
          for (const r of meaningful.slice(0, 5)) {
            section += `- **${r.user.login}** (${r.state}): ${r.body!.slice(0, 300)}${r.body!.length > 300 ? '...' : ''}\n`
          }
        }
      }

      return section
    })
  )

  return detailed.join('\n---\n\n')
}

// --- Commits ---

interface CommitResponse {
  sha: string
  commit: {
    message: string
    author: { name: string; date: string }
  }
  stats?: { additions: number; deletions: number; total: number }
  files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[]
}

export async function fetchRecentCommits(owner: string, repo: string, count: number = 10): Promise<string> {
  const commits = await ghFetch<CommitResponse[]>(
    `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${count}`
  )

  if (commits.length === 0) return 'No commits found.'

  let result = ''
  for (const c of commits) {
    const detail = await ghFetch<CommitResponse>(
      `https://api.github.com/repos/${owner}/${repo}/commits/${c.sha}`
    )

    result += `## ${c.sha.slice(0, 7)} — ${c.commit.message.split('\n')[0]}\n`
    result += `- **Author:** ${c.commit.author.name}\n`
    result += `- **Date:** ${c.commit.author.date}\n`

    if (detail.stats) {
      result += `- **Changes:** +${detail.stats.additions} -${detail.stats.deletions}\n`
    }

    if (detail.files && detail.files.length > 0) {
      result += `- **Files:** ${detail.files.map((f) => f.filename).join(', ')}\n`
    }

    if (c.commit.message.includes('\n')) {
      result += `\n${c.commit.message.split('\n').slice(1).join('\n').trim()}\n`
    }

    result += '\n'
  }

  return result
}

// --- Issues ---

interface IssueResponse {
  number: number
  title: string
  state: string
  user: { login: string }
  created_at: string
  labels: { name: string }[]
  body: string | null
  comments: number
  pull_request?: unknown
}

interface CommentResponse {
  user: { login: string }
  created_at: string
  body: string
}

export async function fetchRecentIssues(owner: string, repo: string, count: number = 10): Promise<string> {
  const issues = await ghFetch<IssueResponse[]>(
    `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=${count}`
  )

  const filtered = issues.filter((i) => !i.pull_request)
  if (filtered.length === 0) return 'No issues found.'

  const detailed = await Promise.all(
    filtered.slice(0, count).map(async (issue) => {
      let section = `## Issue #${issue.number}: ${issue.title}\n`
      section += `- **State:** ${issue.state}\n`
      section += `- **Author:** ${issue.user.login}\n`
      section += `- **Created:** ${issue.created_at}\n`

      if (issue.labels.length > 0) {
        section += `- **Labels:** ${issue.labels.map((l) => l.name).join(', ')}\n`
      }

      if (issue.body) {
        section += `\n${issue.body.slice(0, 1500)}${issue.body.length > 1500 ? '...' : ''}\n`
      }

      if (issue.comments > 0) {
        const comments = await ghFetch<CommentResponse[]>(
          `https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}/comments?per_page=5`
        )
        if (comments.length > 0) {
          section += `\n### Comments (${issue.comments} total)\n`
          for (const c of comments) {
            section += `- **${c.user.login}** (${c.created_at}): ${c.body.slice(0, 300)}${c.body.length > 300 ? '...' : ''}\n`
          }
        }
      }

      return section
    })
  )

  return detailed.join('\n---\n\n')
}

// --- Branches & Tags ---

export async function fetchBranches(owner: string, repo: string): Promise<string> {
  const branches = await ghFetch<{ name: string; protected: boolean }[]>(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=30`
  )
  return branches.map((b) => `- \`${b.name}\`${b.protected ? ' (protected)' : ''}`).join('\n')
}

// --- Contributors ---

export async function fetchContributors(owner: string, repo: string): Promise<string> {
  const contributors = await ghFetch<{ login: string; contributions: number }[]>(
    `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=20`
  )
  return contributors
    .map((c) => `- **${c.login}**: ${c.contributions} commits`)
    .join('\n')
}

// --- Repo Overview ---

interface RepoDetail {
  full_name: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  default_branch: string
  created_at: string
  updated_at: string
  topics: string[]
  license: { name: string } | null
}

export async function fetchRepoOverview(owner: string, repo: string): Promise<string> {
  const detail = await ghFetch<RepoDetail>(
    `https://api.github.com/repos/${owner}/${repo}`
  )

  let result = `# ${detail.full_name}\n\n`
  if (detail.description) result += `${detail.description}\n\n`
  result += `- **Language:** ${detail.language || 'N/A'}\n`
  result += `- **Stars:** ${detail.stargazers_count} | **Forks:** ${detail.forks_count}\n`
  result += `- **Open Issues:** ${detail.open_issues_count}\n`
  result += `- **Default Branch:** ${detail.default_branch}\n`
  result += `- **Created:** ${detail.created_at}\n`
  result += `- **Last Updated:** ${detail.updated_at}\n`
  if (detail.license) result += `- **License:** ${detail.license.name}\n`
  if (detail.topics.length > 0) result += `- **Topics:** ${detail.topics.join(', ')}\n`

  return result
}

// --- Tool Detection & Dispatch ---

interface ToolResult {
  tool: string
  data: string
}

const TOOL_PATTERNS: { pattern: RegExp; tool: string; handler: (owner: string, repo: string, match: RegExpMatchArray) => Promise<string> }[] = [
  {
    pattern: /\b(?:PR|pull request|pull requests|PRs|merge request)\b/i,
    tool: 'pull_requests',
    handler: async (owner, repo, match) => {
      const countMatch = match.input?.match(/(?:last|recent|top|latest)\s+(\d+)/i)
      const count = countMatch ? Math.min(parseInt(countMatch[1]), 10) : 5
      return fetchRecentPRs(owner, repo, count)
    }
  },
  {
    pattern: /\b(?:commit|commits|commit history|git log)\b/i,
    tool: 'commits',
    handler: async (owner, repo, match) => {
      const countMatch = match.input?.match(/(?:last|recent|top|latest)\s+(\d+)/i)
      const count = countMatch ? Math.min(parseInt(countMatch[1]), 20) : 10
      return fetchRecentCommits(owner, repo, count)
    }
  },
  {
    pattern: /\b(?:issue|issues|bug|bugs|feature request)\b/i,
    tool: 'issues',
    handler: async (owner, repo, match) => {
      const countMatch = match.input?.match(/(?:last|recent|top|latest)\s+(\d+)/i)
      const count = countMatch ? Math.min(parseInt(countMatch[1]), 15) : 10
      return fetchRecentIssues(owner, repo, count)
    }
  },
  {
    pattern: /\b(?:branch|branches)\b/i,
    tool: 'branches',
    handler: async (owner, repo) => fetchBranches(owner, repo)
  },
  {
    pattern: /\b(?:contributor|contributors|who contribut|team)\b/i,
    tool: 'contributors',
    handler: async (owner, repo) => fetchContributors(owner, repo)
  },
  {
    pattern: /\b(?:overview|about this repo|repo info|repo details|describe this repo)\b/i,
    tool: 'repo_overview',
    handler: async (owner, repo) => fetchRepoOverview(owner, repo)
  }
]

export async function detectAndFetchToolsByFullName(fullName: string, prompt: string): Promise<ToolResult[]> {
  const [owner, repoName] = fullName.split('/')
  if (!owner || !repoName) return []

  const results: ToolResult[] = []
  const matchedTools = new Set<string>()

  for (const { pattern, tool, handler } of TOOL_PATTERNS) {
    const match = prompt.match(pattern)
    if (match && !matchedTools.has(tool)) {
      matchedTools.add(tool)
      try {
        const data = await handler(owner, repoName, match)
        results.push({ tool, data })
      } catch (err) {
        results.push({ tool, data: `Error fetching ${tool}: ${err instanceof Error ? err.message : 'unknown error'}` })
      }
    }
  }

  return results
}

export async function detectAndFetchTools(repoId: string, prompt: string): Promise<ToolResult[]> {
  const db = getDb()
  const repo = db.prepare('SELECT full_name FROM indexed_repos WHERE id = ?').get(repoId) as
    | { full_name: string }
    | undefined

  if (!repo) return []
  return detectAndFetchToolsByFullName(repo.full_name, prompt)
}

/**
 * Try to detect an owner/repo reference in the prompt.
 * Matches explicit "owner/repo" patterns and repo names against indexed repos.
 */
export function detectRepoFromPrompt(prompt: string): { fullName: string; indexedRepoId: string | null } | null {
  const db = getDb()

  // 1. Match explicit owner/repo patterns (e.g. "setu-payments/api", "facebook/react")
  const explicitMatch = prompt.match(/\b([\w.-]+\/[\w.-]+)\b/)
  if (explicitMatch) {
    const fullName = explicitMatch[1]
    const indexed = db.prepare('SELECT id FROM indexed_repos WHERE full_name = ?').get(fullName) as
      | { id: string }
      | undefined
    return { fullName, indexedRepoId: indexed?.id || null }
  }

  // 2. Match against indexed repo names (short name or full name)
  const indexedRepos = db.prepare('SELECT id, full_name FROM indexed_repos').all() as { id: string; full_name: string }[]
  const promptLower = prompt.toLowerCase()

  for (const ir of indexedRepos) {
    const shortName = ir.full_name.split('/').pop()!.toLowerCase()
    if (promptLower.includes(shortName) || promptLower.includes(ir.full_name.toLowerCase())) {
      return { fullName: ir.full_name, indexedRepoId: ir.id }
    }
  }

  return null
}

export function formatToolResults(results: ToolResult[]): string {
  if (results.length === 0) return ''

  let context = '\n## Live GitHub Data\n\n'
  for (const { tool, data } of results) {
    const label = tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    context += `### ${label}\n\n${data}\n\n`
  }
  return context
}
