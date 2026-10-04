import type { BenchmarkMode, BenchmarkResults, BenchmarkRun, HumanLabel } from './types'

const modes: BenchmarkMode[] = ['baseline', 'phase-a']
const mean = (values: number[]): number => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0

export function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower)
}

export function validateLabels(results: BenchmarkResults, labels: HumanLabel[]): void {
  const seen = new Set<string>()
  for (const label of labels) {
    if (!results.blindMapping[label.id] || seen.has(label.id)) throw new Error(`Unknown or duplicate blind label: ${label.id}`)
    if (!Number.isFinite(label.qualityScore) || label.qualityScore < 0 || label.qualityScore > 4 || typeof label.falseStop !== 'boolean') throw new Error('Labels need a qualityScore from 0–4 and a boolean falseStop')
    const run = results.runs.find((r) => r.id === results.blindMapping[label.id])
    if (!run || (run.synthesis === null && label.qualityScore !== 0)) throw new Error('Missing syntheses must receive score zero')
    seen.add(label.id)
  }
}

// Resample distinct prompts, retaining paired modes and averaging repeated runs.
// A fixed seed makes relabeling reports reproducible.
export function pairedLowerBound(differences: number[]): number {
  let seed = 1729
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const samples = Array.from({ length: 5000 }, () => mean(differences.map(() => differences[Math.floor(random() * differences.length)])))
  return percentile(samples, 0.05)
}

export function falseStopUpperBound(failures: number, count: number): number {
  if (!count) return 1
  const z = 1.6448536269514722 // one-sided 95% Wilson bound
  const rate = failures / count
  return (rate + z * z / (2 * count) + z * Math.sqrt(rate * (1 - rate) / count + z * z / (4 * count * count))) / (1 + z * z / count)
}

export interface QualityGate {
  status: 'pending' | 'pass' | 'fail'
  explanation: string
  pairedPrompts: number
  meanDifference: number | null
  lowerBound: number | null
  falseStopRate: number | null
  falseStopUpper: number | null
}

export function evaluateQuality(results: BenchmarkResults, labels: HumanLabel[]): QualityGate {
  validateLabels(results, labels)
  const byRun = new Map(labels.map((l) => [results.blindMapping[l.id], l]))
  const heldOut = results.runs.filter((r) => r.split === 'held-out')
  const differences: number[] = []
  let falseStops = 0
  const expectedPrompts = results.prompts.filter((p) => p.split === 'held-out')
  for (const promptId of new Set(expectedPrompts.map((p) => p.id))) {
    const paired = modes.map((mode) => heldOut.filter((r) => r.promptId === promptId && r.mode === mode))
    if (paired.some((runs) => runs.length !== results.config.runsPerPrompt || runs.some((r) => !byRun.has(r.id)))) continue
    differences.push(mean(paired[1].map((r) => byRun.get(r.id)!.qualityScore)) - mean(paired[0].map((r) => byRun.get(r.id)!.qualityScore)))
    // A prompt is a failure if any repeated Phase-A run stops prematurely.
    if (paired[1].some((r) => byRun.get(r.id)!.falseStop)) falseStops++
  }
  const base = { pairedPrompts: differences.length, meanDifference: differences.length ? mean(differences) : null, lowerBound: null, falseStopRate: differences.length ? falseStops / differences.length : null, falseStopUpper: null }
  if (results.execution === 'fixture') return { ...base, status: 'pending', explanation: 'Fixture runs verify the harness only; they cannot establish model quality or performance.' }
  if (differences.length !== expectedPrompts.length || heldOut.some((r) => !byRun.has(r.id)) || differences.length < results.config.minHeldOutSamples) return { ...base, status: 'pending', explanation: `Label every held-out run and include at least ${results.config.minHeldOutSamples} distinct paired held-out prompts. The bundled 20-prompt set is a smoke test.` }
  const lowerBound = pairedLowerBound(differences)
  const falseStopUpper = falseStopUpperBound(falseStops, differences.length)
  const pass = lowerBound >= -results.config.nonInferiorityMargin && falseStopUpper <= results.config.maxFalseStopRate
  return { ...base, lowerBound, falseStopUpper, status: pass ? 'pass' : 'fail', explanation: 'Paired prompt bootstrap lower bound and held-out false-stop upper bound are compared with the configured limits (one-sided 95%).' }
}

function modeRow(mode: BenchmarkMode, runs: BenchmarkRun[], byRun: Map<string, HumanLabel>): string {
  const phaseCalls = ['initial', 'debate', 'moderator', 'synthesis'].map((phase) => runs.reduce((n, r) => n + r.calls.filter((c) => c.phase === phase).length, 0)).join('/')
  const scores = runs.flatMap((r) => byRun.has(r.id) ? [byRun.get(r.id)!.qualityScore] : [])
  return `| ${mode} | ${runs.length} | ${runs.filter((r) => r.synthesis === null).length} | ${mean(runs.map((r) => r.rounds)).toFixed(2)} | ${(percentile(runs.map((r) => r.elapsedMs), 0.5) / 1000).toFixed(3)} | ${(percentile(runs.map((r) => r.elapsedMs), 0.95) / 1000).toFixed(3)} | ${phaseCalls} | ${runs.reduce((n, r) => n + r.inputTokens, 0)} | ${runs.reduce((n, r) => n + r.outputTokens, 0)} | $${runs.reduce((n, r) => n + r.estimatedCostUsd, 0).toFixed(6)} | ${scores.length ? `${mean(scores).toFixed(2)} (${scores.length} labeled)` : 'Pending labels'} |`
}

export function renderReport(results: BenchmarkResults, labels: HumanLabel[] = []): string {
  const gate = evaluateQuality(results, labels)
  const byRun = new Map(labels.map((l) => [results.blindMapping[l.id], l]))
  const rows = modes.map((mode) => modeRow(mode, results.runs.filter((r) => r.mode === mode), byRun))
  const stops = modes.map((mode) => {
    const counts: Record<string, number> = {}
    results.runs.filter((r) => r.mode === mode).forEach((r) => { const key = r.terminationReason ?? 'unknown'; counts[key] = (counts[key] ?? 0) + 1 })
    return `- ${mode}: ${Object.entries(counts).map(([reason, count]) => `${reason}=${count}`).join(', ')}`
  })
  return [
    '# Orchestration benchmark', '',
    `Execution: **${results.execution}**. Baseline behavior: \`${results.baselineRevision}\`; working revision: \`${results.revision}\`.`, '',
    `Compiled runner SHA-256: \`${results.runnerHash ?? 'not recorded'}\`.`, '',
    'Baseline uses frozen pre-change prompts and stopping semantics, with the same headless runner and corrected call instrumentation in both modes. Tool routing is disabled. No Jev calls are made.', '',
    'Token counts and USD costs are estimates: chars ÷ 4 plus tool-call payloads, using the explicit prices in the run configuration. Times include pipeline work; totals include failed provider attempts. No provider billing reconciliation is performed.', '',
    '| Mode | Runs | Missing synthesis | Mean rounds | p50 seconds | p95 seconds | Calls initial/debate/moderator/synthesis | Input est. | Output est. | Total USD est. | Mean quality (0–4) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |', ...rows, '',
    '## Termination outcomes', '', ...stops, '',
    '## Held-out quality gate', '', `**${gate.status.toUpperCase()}** — ${gate.explanation}`, '',
    `Paired prompts: ${gate.pairedPrompts}. Mean Phase-A minus baseline score: ${gate.meanDifference?.toFixed(3) ?? 'pending'}. Lower bound: ${gate.lowerBound?.toFixed(3) ?? 'pending'}; required ≥ ${-results.config.nonInferiorityMargin}.`, '',
    `Held-out false-stop rate: ${gate.falseStopRate === null ? 'pending' : (100 * gate.falseStopRate).toFixed(2) + '%'}. Upper bound: ${gate.falseStopUpper === null ? 'pending' : (100 * gate.falseStopUpper).toFixed(2) + '%'}; required ≤ ${(100 * results.config.maxFalseStopRate).toFixed(2)}%.`, '',
    '## Categories', '',
    '| Category | Mode | Runs | Mean rounds | p50 seconds | p95 seconds |', '| --- | --- | ---: | ---: | ---: | ---: |',
    ...[...new Set(results.runs.map((r) => r.category))].flatMap((category) => modes.map((mode) => {
      const runs = results.runs.filter((r) => r.category === category && r.mode === mode)
      return `| ${category} | ${mode} | ${runs.length} | ${mean(runs.map((r) => r.rounds)).toFixed(2)} | ${(percentile(runs.map((r) => r.elapsedMs), 0.5) / 1000).toFixed(3)} | ${(percentile(runs.map((r) => r.elapsedMs), 0.95) / 1000).toFixed(3)} |`
    })), ''
  ].join('\n')
}
