import { describe, expect, it } from 'vitest'
import { evaluateQuality, falseStopUpperBound, percentile, renderReport, validateLabels } from './report'
import { fixtureConfig } from './fixture'
import type { BenchmarkResults, BenchmarkRun, HumanLabel } from './types'

function data(count = 100, phaseScore = 4, falseStop = false): { results: BenchmarkResults; labels: HumanLabel[] } {
  const runs: BenchmarkRun[] = []
  const labels: HumanLabel[] = []
  const blindMapping: Record<string, string> = {}
  for (let i = 0; i < count; i++) for (const mode of ['baseline', 'phase-a'] as const) {
    const id = `${i}-${mode}`
    blindMapping[`blind-${id}`] = id
    runs.push({ id, mode, promptId: String(i), category: 'test', split: 'held-out', elapsedMs: 1000, rounds: 2, terminationReason: 'converged', calls: [], inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.001, synthesis: 'Answer', messages: [], verdicts: [] })
    labels.push({ id: `blind-${id}`, qualityScore: mode === 'phase-a' ? phaseScore : 4, falseStop: mode === 'phase-a' && falseStop })
  }
  const prompts = Array.from({ length: count }, (_, i) => ({ id: String(i), category: 'test', split: 'held-out' as const, prompt: 'Question', reference: 'Reference', rubric: ['Correct'] }))
  return { results: { execution: 'live', baselineRevision: 'base', revision: 'current', config: fixtureConfig, prompts, runs, blindMapping }, labels }
}

describe('benchmark comparison report', () => {
  it('interpolates percentiles without changing the original samples', () => {
    const samples = [9, 1, 5]
    expect(percentile(samples, 0.5)).toBe(5)
    expect(percentile(samples, 0.95)).toBeCloseTo(8.6)
    expect(samples).toEqual([9, 1, 5])
  })

  it('never treats synthetic fixtures, missing labels or a smoke set as calibration', () => {
    const { results, labels } = data()
    expect(evaluateQuality({ ...results, execution: 'fixture' }, labels).status).toBe('pending')
    expect(evaluateQuality(results, labels.slice(1)).status).toBe('pending')
    const smoke = data(10)
    expect(evaluateQuality(smoke.results, smoke.labels).status).toBe('pending')
    expect(renderReport(results)).toContain('Pending labels')
  })

  it('checks paired non-inferiority and a conservative held-out false-stop bound', () => {
    const equal = data()
    expect(evaluateQuality(equal.results, equal.labels)).toMatchObject({ status: 'pass', pairedPrompts: 100, meanDifference: 0, lowerBound: 0, falseStopRate: 0 })
    const inferior = data(100, 3)
    expect(evaluateQuality(inferior.results, inferior.labels).status).toBe('fail')
    const badStops = data(100, 4, true)
    expect(evaluateQuality(badStops.results, badStops.labels).status).toBe('fail')
    expect(falseStopUpperBound(0, 20)).toBeGreaterThan(0.05)
  })

  it('counts repeated runs by distinct prompt and retains failures in paired samples', () => {
    const { results, labels } = data(10)
    results.config = { ...fixtureConfig, runsPerPrompt: 2 }
    results.runs = results.runs.flatMap((r) => [r, { ...r, id: `${r.id}-repeat`, synthesis: null }])
    for (const label of [...labels]) {
      const id = `${label.id}-repeat`
      results.blindMapping[id] = `${results.blindMapping[label.id]}-repeat`
      labels.push({ ...label, id, qualityScore: 0 })
    }
    expect(evaluateQuality(results, labels).pairedPrompts).toBe(10)
    expect(evaluateQuality(results, labels).status).toBe('pending')
  })

  it('rejects unknown, duplicate, incomplete or out-of-scale labels', () => {
    const { results, labels } = data(1)
    expect(() => validateLabels(results, [labels[0], labels[0]])).toThrow(/duplicate/)
    expect(() => validateLabels(results, [{ ...labels[0], id: 'missing' }])).toThrow(/Unknown/)
    expect(() => validateLabels(results, [{ ...labels[0], qualityScore: 5 }])).toThrow()
    expect(() => validateLabels(results, [{ ...labels[0], qualityScore: null as unknown as number }])).toThrow()
    results.runs[0].synthesis = null
    expect(() => validateLabels(results, [labels[0]])).toThrow(/score zero/)
  })

  it('cannot pass by dropping expected held-out runs from the dataset', () => {
    const { results, labels } = data(101)
    results.runs = results.runs.filter((r) => r.promptId !== '100')
    const remaining = labels.filter((l) => !l.id.startsWith('blind-100-'))
    expect(evaluateQuality(results, remaining).status).toBe('pending')
  })
})
