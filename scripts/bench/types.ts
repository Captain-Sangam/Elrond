import type { AgentConfig, Message, ModeratorVerdictEvent, TerminationReason } from '../../src/shared/types'
import type { ProviderCallRecord } from '../../src/main/orchestrator/runner'

export type BenchmarkMode = 'baseline' | 'phase-a'
export interface BenchmarkPrompt {
  id: string
  category: string
  split: 'calibration' | 'held-out'
  prompt: string
  reference: string
  rubric: string[]
}
export interface BenchmarkAgent extends AgentConfig {
  credentialEnv?: string
  baseURL?: string
  modelRevision?: string
  inputUsdPerMillion: number
  outputUsdPerMillion: number
}
export interface BenchmarkConfig {
  agents: BenchmarkAgent[]
  synthesizerAgentId: string
  maxDebateRounds: number
  runsPerPrompt: number
  timeoutMs: number
  nonInferiorityMargin: number
  maxFalseStopRate: number
  minHeldOutSamples: number
}
export interface BenchmarkRun {
  id: string
  mode: BenchmarkMode
  promptId: string
  category: string
  split: BenchmarkPrompt['split']
  elapsedMs: number
  rounds: number
  terminationReason: TerminationReason | null
  calls: ProviderCallRecord[]
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  synthesis: string | null
  messages: Message[]
  verdicts: ModeratorVerdictEvent[]
}
export interface BlindItem {
  id: string
  promptId: string
  prompt: string
  reference: string
  rubric: string[]
  synthesis: string | null
  positions: { participant: string; content: string }[]
  stopReason: TerminationReason | null
}
export interface HumanLabel {
  id: string
  qualityScore: number
  falseStop: boolean
}
export interface BenchmarkResults {
  execution: 'fixture' | 'live'
  baselineRevision: string
  revision: string
  runnerHash?: string
  config: BenchmarkConfig
  prompts: BenchmarkPrompt[]
  runs: BenchmarkRun[]
  blindMapping: Record<string, string>
}
