import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { runMigrations } from '../../src/main/db/schema'
import { createDeliberationRunner } from '../../src/main/orchestrator/runner'
import type { AgentProvider } from '../../src/main/orchestrator/providers/types'
import type { Message, ModeratorVerdictEvent, PhaseChange, ProviderName } from '../../src/shared/types'
import * as baselinePrompts from './baseline/prompts'
import { splitDebateResponse } from '../../src/main/orchestrator/prompts'
import type { BenchmarkConfig, BenchmarkMode, BenchmarkPrompt, BenchmarkResults, BenchmarkRun, BlindItem } from './types'

export const BASELINE_REVISION = '7fe4439'

export function validateConfig(config: BenchmarkConfig): void {
  const agents = config.agents
  if (!Array.isArray(agents) || agents.length < 2 || agents.length > 4 || new Set(agents.map((a) => a.id)).size !== agents.length) throw new Error('Configure two to four uniquely identified agents')
  for (const a of agents) {
    if (!a.enabled || !a.id || !a.name || !a.model || !['openai', 'anthropic', 'google', 'ollama'].includes(a.provider)) throw new Error('Every benchmark agent must have an enabled, fixed provider/model configuration')
    if (![a.inputUsdPerMillion, a.outputUsdPerMillion].every((v) => Number.isFinite(v) && v >= 0)) throw new Error('Provide non-negative pricing for each configured model')
  }
  if (!agents.some((a) => a.id === config.synthesizerAgentId)) throw new Error('Synthesizer must be in the fixed agent set')
  if (!Number.isInteger(config.maxDebateRounds) || config.maxDebateRounds < 1 || config.maxDebateRounds > 5) throw new Error('maxDebateRounds must be 1–5')
  if (!Number.isInteger(config.runsPerPrompt) || config.runsPerPrompt < 1) throw new Error('runsPerPrompt must be a positive integer')
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) throw new Error('timeoutMs must be positive')
  if (!Number.isFinite(config.nonInferiorityMargin) || config.nonInferiorityMargin < 0 || config.nonInferiorityMargin > 4) throw new Error('Quality margin must be on the 0–4 scale')
  if (!Number.isFinite(config.maxFalseStopRate) || config.maxFalseStopRate < 0 || config.maxFalseStopRate > 1) throw new Error('False-stop bound must be 0–1')
  if (!Number.isInteger(config.minHeldOutSamples) || config.minHeldOutSamples < 20) throw new Error('At least 20 distinct held-out prompts are required for a quality gate')
}

export function validatePrompts(prompts: BenchmarkPrompt[]): void {
  if (!Array.isArray(prompts) || !prompts.length || new Set(prompts.map((p) => p.id)).size !== prompts.length) throw new Error('Prompts must have unique IDs')
  for (const p of prompts) {
    if (!p.id || !p.category || !p.prompt || !p.reference || !Array.isArray(p.rubric) || !p.rubric.length || !p.rubric.every((r) => typeof r === 'string') || !['calibration', 'held-out'].includes(p.split)) throw new Error('Each prompt needs a category, split, reference, and labeling rubric')
  }
}

export async function runBenchmarkSuite(params: {
  config: BenchmarkConfig
  prompts: BenchmarkPrompt[]
  execution: BenchmarkResults['execution']
  revision: string
  runnerHash?: string
  providers: Record<ProviderName, AgentProvider>
  resolveCredential: (name: ProviderName) => Promise<string>
  onProgress?: (message: string) => void
  onRun?: (runs: BenchmarkRun[]) => Promise<void>
}): Promise<{ results: BenchmarkResults; blindItems: BlindItem[] }> {
  validateConfig(params.config)
  validatePrompts(params.prompts)
  const runs: BenchmarkRun[] = []
  const { config, providers, resolveCredential } = params
  const modes: BenchmarkMode[] = ['baseline', 'phase-a']
  for (let i = 0; i < params.prompts.length; i++) {
    const prompt = params.prompts[i]
    // Alternate order to reduce a systematic cache/warm-up advantage.
    const order = i % 2 ? [...modes].reverse() : modes
    for (let repetition = 0; repetition < config.runsPerPrompt; repetition++) {
      for (const mode of order) {
        const db = new Database(':memory:')
        db.pragma('foreign_keys = ON')
        runMigrations(db)
        const id = randomUUID()
        db.prepare('INSERT INTO sessions (id, title) VALUES (?, ?)').run(id, `Benchmark ${prompt.id}`)
        const calls: BenchmarkRun['calls'] = []
        const verdicts: ModeratorVerdictEvent[] = []
        let terminal: PhaseChange | undefined
        const runner = createDeliberationRunner({
          getDb: () => db, providers, resolveCredential,
          send: (channel, data) => {
            if (channel === 'stream:moderator') verdicts.push(data as ModeratorVerdictEvent)
            if (channel === 'stream:phase' && (data as PhaseChange).phase === 'complete') terminal = data as PhaseChange
          },
          onCall: (call) => calls.push(call),
          ...(mode === 'baseline' ? { prompts: baselinePrompts, legacyDebate: true } : {})
        })
        const started = performance.now()
        const timer = setTimeout(() => runner.cancelDeliberation(), config.timeoutMs)
        try {
          await runner.startDeliberation({
            sessionId: id, prompt: prompt.prompt, agents: config.agents,
            enableDebate: true, maxDebateRounds: config.maxDebateRounds,
            synthesizerAgentId: config.synthesizerAgentId, mcpTools: false, webSearch: false
          })
          const messages = db.prepare('SELECT * FROM messages ORDER BY rowid').all() as Message[]
          const cost = calls.reduce((sum, call) => {
            const a = config.agents.find((a) => a.id === call.agentId)!
            return sum + (call.inputTokens * a.inputUsdPerMillion + call.outputTokens * a.outputUsdPerMillion) / 1_000_000
          }, 0)
          runs.push({
            id, mode, promptId: prompt.id, category: prompt.category, split: prompt.split,
            elapsedMs: performance.now() - started,
            rounds: Math.max(0, ...verdicts.map((v) => v.round), ...calls.map((c) => c.round)),
            terminationReason: terminal?.terminationReason ?? messages.find((m) => m.role === 'user')?.termination_reason ?? null,
            calls, inputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
            outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
            estimatedCostUsd: cost, synthesis: messages.find((m) => m.role === 'synthesis')?.content ?? null,
            messages, verdicts
          })
          params.onProgress?.(`${mode}: ${prompt.id} (${repetition + 1}/${config.runsPerPrompt})`)
          await params.onRun?.(runs)
        } finally {
          clearTimeout(timer)
          db.close()
        }
      }
    }
  }
  const blindMapping: Record<string, string> = {}
  const blindItems = runs.map((r) => {
    const id = randomUUID()
    blindMapping[id] = r.id
    const prompt = params.prompts.find((p) => p.id === r.promptId)!
    const participantIds = new Map(config.agents.map((a, index) => [a.id, `Participant ${index + 1}`]))
    const finalPositions = new Map<string, string>()
    for (const m of r.messages) {
      if ((m.role === 'agent' || m.role === 'debate') && m.agent_id) finalPositions.set(m.agent_id, m.role === 'debate' ? splitDebateResponse(m.content).revised : m.content)
    }
    return {
      id, promptId: prompt.id, prompt: prompt.prompt, reference: prompt.reference, rubric: prompt.rubric,
      synthesis: r.synthesis, stopReason: r.terminationReason,
      positions: [...finalPositions].map(([agentId, content]) => ({ participant: participantIds.get(agentId) ?? 'Participant', content }))
    }
  }).sort((a, b) => a.id.localeCompare(b.id))
  return { results: { execution: params.execution, baselineRevision: BASELINE_REVISION, revision: params.revision, runnerHash: params.runnerHash, config, prompts: params.prompts, runs, blindMapping }, blindItems }
}
