export interface DebateIssueReport {
  disputed: string[]
  newIssues: string[]
}

export function presentDebateResponse(content: string, streaming = false): {
  body: string
  report: DebateIssueReport | null
} {
  const text = content.trimStart()
  // Suppress the protocol header while its first tokens are still arriving.
  if (streaming && text && ('STATUS'.startsWith(text) || /^STATUS\s*$/.test(text))) {
    return { body: '', report: null }
  }
  const prefix = text.match(/^STATUS\s*\{/)
  if (!prefix) return { body: content, report: null }

  const start = prefix[0].length - 1
  let depth = 0
  let quoted = false
  let escaped = false
  let end = -1
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) {
      end = i + 1
      break
    }
  }
  if (end < 0) {
    // Recover the answer if a malformed header precedes a normal debate section.
    const bodyStart = text.search(streaming
      ? /\n(?=##\s*(?:Critique|Revised Answer)\b)/i
      : /\n(?=##\s*(?:Critique|Revised Answer)\b)|\n\s*\n/i)
    return { body: bodyStart < 0 ? '' : text.slice(bodyStart).trimStart(), report: null }
  }

  const body = text.slice(end).trimStart()
  try {
    const data = JSON.parse(text.slice(start, end))
    if (!Array.isArray(data.disputed) || !Array.isArray(data.newIssues) ||
        ![...data.disputed, ...data.newIssues].every((v) => typeof v === 'string')) return { body, report: null }
    const clean = (values: string[]): string[] => Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)))
    return { body, report: { disputed: clean(data.disputed), newIssues: clean(data.newIssues) } }
  } catch { return { body, report: null } }
}

export function describeIssueReport(report: DebateIssueReport): string {
  const parts: string[] = []
  if (report.disputed.length) parts.push(`${report.disputed.length} open ${report.disputed.length === 1 ? 'issue' : 'issues'}`)
  if (report.newIssues.length) parts.push(`${report.newIssues.length} new ${report.newIssues.length === 1 ? 'point' : 'points'}`)
  return parts.join(' · ') || 'No issues raised'
}
