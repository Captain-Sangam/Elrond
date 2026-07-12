export interface DebateOpponent {
  name: string
  position: string
  critique: string | null
}

export function getDebateRoundPrompt(
  agentName: string,
  round: number,
  ownPosition: string,
  others: DebateOpponent[]
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

Your task:
1. **Critique** the other positions: identify concrete errors, gaps, or weak reasoning, naming the agent you disagree with. If you now agree with a point you previously disputed, concede it explicitly.
2. **Revise** your own answer, incorporating any valid points from the others.

Be concise, direct, and constructive. Focus on substance, not politeness.

Format your response EXACTLY as:

## Critique
<your critique of the other agents' positions>

## Revised Answer
<your complete, self-contained answer to the user's query. It fully replaces your previous answer and must not reference the debate itself.>`
}

// Splits a debate response into its critique and revised-answer sections.
// If the agent ignored the format, the whole response becomes the new position.
export function splitDebateResponse(content: string): { critique: string; revised: string } {
  const match = content.match(/^##\s*Revised Answer\s*$/im)
  if (!match || match.index === undefined) {
    return { critique: '', revised: content.trim() }
  }
  const critique = content
    .slice(0, match.index)
    .replace(/^##\s*Critique\s*$/im, '')
    .trim()
  const revised = content.slice(match.index + match[0].length).trim()
  return { critique, revised: revised || content.trim() }
}

export function getModeratorPrompt(
  userPrompt: string,
  positions: { name: string; position: string }[],
  round: number
): string {
  const positionsText = positions.map((p) => `### ${p.name}\n${p.position}`).join('\n\n')

  return `You are the impartial moderator of a multi-agent debate about the user's question below. Round ${round} has just finished.

User question:
${userPrompt}

Current positions:

${positionsText}

Decide whether the agents have CONVERGED — i.e. their answers agree on all substantive points. Differences in style, ordering, or emphasis count as converged.

Respond with ONLY a single JSON object — no markdown fences, no commentary:
{"converged": <true|false>, "disagreements": ["<one short phrase per remaining substantive disagreement>"], "summary": "<one sentence a user can read, e.g. 'Agents still disagree on X and Y.'>"}`
}

export interface ModeratorVerdict {
  converged: boolean
  disagreements: string[]
  summary: string
  parseFailed?: boolean
}

// Fail-safe direction is "converged": a malformed verdict ends the debate
// early rather than looping.
export function parseModeratorVerdict(raw: string): ModeratorVerdict {
  try {
    const stripped = raw.replace(/```(?:json)?/gi, '').trim()
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('no JSON object found')
    const parsed = JSON.parse(stripped.slice(start, end + 1))
    return {
      converged: Boolean(parsed.converged),
      disagreements: Array.isArray(parsed.disagreements) ? parsed.disagreements.map(String) : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : ''
    }
  } catch {
    return {
      converged: true,
      disagreements: [],
      summary: 'Moderator verdict unreadable — ending debate.',
      parseFailed: true
    }
  }
}

export function getSynthesisPrompt(
  finalPositions: { name: string; initial: string; final: string }[],
  roundSummaries: { round: number; disagreements: string[] }[]
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
        s.disagreements.length > 0
          ? `- Round ${s.round}: unresolved disagreements — ${s.disagreements.join('; ')}`
          : `- Round ${s.round}: no substantive disagreements remained`
      )
      .join('\n')
    debateContext = `\n\nThe agents debated for ${roundSummaries.length} round(s). The moderator's per-round findings:\n${summaryLines}`
  }

  return `You are the synthesizer in a multi-agent deliberation. Multiple AI agents have each provided a response to the user's query${debated ? ', then debated and revised their positions across one or more rounds' : ''}. Your job is to produce a final, consolidated answer that:

1. **Integrates the best reasoning** from all agents
2. **Resolves disagreements** by explaining which position is stronger and why
3. **Notes remaining uncertainty** — explicitly list any points where the agents genuinely disagree and no clear resolution exists
4. **Is comprehensive but concise** — the user should not need to read the individual responses${debateContext}

Here are the agent outputs:

${sections}

Now produce the final synthesized answer.`
}
