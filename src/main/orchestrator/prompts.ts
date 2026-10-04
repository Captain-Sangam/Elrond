import type { DebateIssue } from '../../shared/types'

export interface DebateOpponent {
  name: string
  position: string
  critique: string | null
}

export function getDebateRoundPrompt(
  agentName: string,
  round: number,
  ownPosition: string,
  others: DebateOpponent[],
  issues: DebateIssue[] = []
): string {
  const otherText = others
    .map((o) => {
      let section = `### ${o.name} — Current Position\n${o.position}`
      if (o.critique) {
        section += `\n\n### ${o.name} — Critique from the Previous Round\n${o.critique}`
      }
      return section
    })
    .join('\n\n')

  return `You are ${agentName} in round ${round} of a structured multi-agent debate about the user's query.

Your current position:
${ownPosition}

The other agents' current positions${round > 1 ? ' and their critiques from the previous round' : ''}:

${otherText}

Unresolved issues from the previous round:
${issues.length ? issues.map((i) => `${i.id}: ${i.description}`).join('\n') : 'No issue inventory yet; identify substantive disagreements independently.'}

Your task:
Address the named issues directly, using evidence. Preserve useful dissent; agreement alone does not establish correctness. Add a new issue only when it materially affects the answer. Avoid repeating settled arguments.
Begin with exactly one status line:
STATUS {"disputed": ["I1"], "newIssues": ["description of a newly discovered issue"]}
Use empty arrays when appropriate. If your answer is unchanged, put UNCHANGED alone in the Revised Answer section, or reply only UNCHANGED. This preserves your previous answer; it does not mean agreement.
1. **Critique** the other positions: identify concrete errors, gaps, or weak reasoning, naming the agent you disagree with. If you now agree with a point you previously disputed, concede it explicitly.
2. **Revise** your own answer, incorporating any valid points from the others.

Be concise, direct, and constructive. Focus on substance, not politeness.

Format your response EXACTLY as:

STATUS {"disputed": [], "newIssues": []}

## Critique
<your critique of the other agents' positions>

## Revised Answer
<your complete, self-contained answer to the user's query. It fully replaces your previous answer and must not reference the debate itself. It must obey any format, length or style constraints in the user's question — "one line only" means exactly one line, "name only" means just the name.>`
}

export interface DebateResponse {
  critique: string
  revised: string
  unchanged?: boolean
  status?: { disputed: string[]; newIssues: string[] }
}

export function splitDebateResponse(content: string): DebateResponse {
  let body = content.trim()
  let status: DebateResponse['status']
  const statusLine = body.match(/^STATUS\s+(\{[^\n]*\})\s*$/m)
  if (statusLine) {
    try {
      const parsed = JSON.parse(statusLine[1])
      if (Array.isArray(parsed.disputed) && parsed.disputed.every((v: unknown) => typeof v === 'string') &&
          Array.isArray(parsed.newIssues) && parsed.newIssues.every((v: unknown) => typeof v === 'string')) {
        status = parsed
        body = body.replace(statusLine[0], '').trim()
      }
    } catch { /* Keep malformed status as content for the moderator to inspect. */ }
  }
  const match = body.match(/^##\s*Revised Answer\s*$/im)
  const critique = match?.index !== undefined
    ? body.slice(0, match.index).replace(/^##\s*Critique\s*$/im, '').trim()
    : ''
  const revised = match?.index !== undefined ? body.slice(match.index + match[0].length).trim() || body : body
  return {
    critique, revised,
    ...(revised === 'UNCHANGED' ? { unchanged: true } : {}),
    ...(status ? { status } : {})
  }
}

export function getModeratorPrompt(
  userPrompt: string,
  positions: { name: string; position: string }[],
  round: number,
  issues: DebateIssue[] = [],
  reports: { name: string; status?: DebateResponse['status'] }[] = []
): string {
  const positionsText = positions.map((p) => `### ${p.name}\n${p.position}`).join('\n\n')

  return `You are the impartial moderator of a multi-agent debate about the user's question below. Round ${round} has just finished.

User question:
${userPrompt}

Current positions:

${positionsText}

Previous unresolved issue inventory:
${issues.length ? issues.map((i) => `${i.id}: ${i.description}`).join('\n') : 'None yet. Build the first inventory from these positions.'}

Agent issue reports (claims to verify against their actual positions):
${JSON.stringify(reports)}

Keep each existing issue's ID when it remains unresolved, even if its description needs clarification. For a new issue omit the ID; code will assign one. Never treat missing responses, confidence, or repetition as agreement. A non-converged verdict must name at least one substantive disagreement. Agreement does not prove correctness.

Decide whether the agents have CONVERGED — i.e. their answers agree on all substantive points. Differences in style, ordering, or emphasis count as converged.

Respond with ONLY a single JSON object — no markdown fences, no commentary:
{"converged": <true|false>, "disagreements": [{"id": "<existing issue ID, or omit for a new issue>", "description": "<remaining substantive disagreement>"}], "summary": "<one sentence a user can read, e.g. 'Agents still disagree on X and Y.'>"}`
}

export interface ModeratorVerdict {
  converged: boolean
  disagreements: string[]
  issues?: DebateIssue[]
  summary: string
  parseFailed?: boolean
}

export function parseModeratorVerdict(
  raw: string,
  previousIssues: DebateIssue[] = [],
  history: DebateIssue[] = previousIssues
): ModeratorVerdict {
  try {
    const stripped = raw.replace(/```(?:json)?/gi, '').trim()
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('no JSON object found')
    const parsed = JSON.parse(stripped.slice(start, end + 1))
    if (typeof parsed.converged !== 'boolean' || !Array.isArray(parsed.disagreements)) throw new Error('invalid verdict')
    let nextId = Math.max(0, ...history.map((i) => Number(i.id.slice(1)) || 0)) + 1
    const used = new Set<string>()
    const issues: DebateIssue[] = parsed.disagreements.map((entry: unknown) => {
      const value = typeof entry === 'string' ? { description: entry } : entry as { id?: string; description?: string } | null
      if (!value || typeof value.description !== 'string' || !value.description.trim()) throw new Error('invalid issue')
      const description = value.description.trim()
      const known = history.find((i) => i.id === value.id) ?? history.find((i) => i.description.toLowerCase() === description.toLowerCase())
      const id = known?.id ?? `I${nextId++}`
      if (used.has(id)) throw new Error('duplicate issue')
      used.add(id)
      return { id, description }
    })
    if (parsed.converged === (issues.length > 0)) throw new Error('contradictory verdict')
    return {
      converged: parsed.converged,
      disagreements: issues.map((i) => `${i.id}: ${i.description}`),
      issues,
      summary: typeof parsed.summary === 'string' ? parsed.summary : ''
    }
  } catch {
    return {
      converged: false,
      disagreements: previousIssues.map((i) => `${i.id}: ${i.description}`),
      issues: previousIssues,
      summary: 'Moderator verdict unreadable — ending debate without confirmed agreement.',
      parseFailed: true
    }
  }
}

export function getSynthesisPrompt(
  userPrompt: string,
  finalPositions: { name: string; initial: string; final: string }[],
  roundSummaries: { round: number; disagreements: string[]; terminationReason?: string | null }[]
): string {
  const debated = roundSummaries.length > 0

  const sections = finalPositions
    .map((r) =>
      debated && r.final !== r.initial
        ? `### ${r.name}\n**Initial Response:**\n${r.initial}\n\n**Final Revised Position (after debate):**\n${r.final}`
        : `### ${r.name}\n**Response:**\n${r.final}`
    )
    .join('\n\n---\n\n')

  let debateContext = ''
  if (debated) {
    const summaryLines = roundSummaries
      .map((s) =>
        s.terminationReason === 'degraded'
          ? `- Round ${s.round}: review unavailable; agreement was not established${s.disagreements.length ? `; unresolved issues — ${s.disagreements.join('; ')}` : ''}`
          : s.disagreements.length > 0
          ? `- Round ${s.round}: unresolved disagreements — ${s.disagreements.join('; ')}`
          : `- Round ${s.round}: no substantive disagreements remained`
      )
      .join('\n')
    debateContext = `\nThe agents debated for ${roundSummaries.length} round(s). The moderator's per-round findings:\n${summaryLines}\n`
  }

  return `You are the synthesizer in a multi-agent deliberation. Multiple AI agents answered the user's question below${debated ? ', then debated and revised their positions' : ''}. Your output will be shown to the user as THE final answer.

User question:
${userPrompt}

Rules:
1. **Answer the user's question directly** — do not summarize the deliberation, mention the agents, or add meta-commentary about the process
2. **Obey the user's format, length and style constraints EXACTLY.** "One line only" means exactly one line; "name only" means just the name; "in JSON" means valid JSON. When a constraint conflicts with completeness, the constraint wins
3. Integrate the strongest, best-supported reasoning from the agents; where they disagreed, adopt the position with the better evidence
4. Mention residual uncertainty only if it materially changes the answer — and keep it within the user's format constraints
5. No headings, titles or preamble unless the user's question asks for them
${debateContext}
Agent outputs:

${sections}

Now write the final answer exactly as the user should see it.`
}
