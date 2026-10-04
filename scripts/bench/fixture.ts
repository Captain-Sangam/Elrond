import { contentToText, type AgentProvider } from '../../src/main/orchestrator/providers/types'
import type { BenchmarkConfig } from './types'

export const fixtureConfig: BenchmarkConfig = {
  agents: [
    { id: 'left', name: 'Left', provider: 'ollama', model: 'fixture-left', enabled: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
    { id: 'right', name: 'Right', provider: 'ollama', model: 'fixture-right', enabled: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0 }
  ],
  synthesizerAgentId: 'left', maxDebateRounds: 3, runsPerPrompt: 1, timeoutMs: 30_000,
  nonInferiorityMargin: 0.25, maxFalseStopRate: 0.05, minHeldOutSamples: 100
}

// Deterministic responses exercise disagreement, focused rounds and stagnation.
// They deliberately make no attempt to answer or evaluate the dataset.
export const fixtureProvider: AgentProvider = {
  name: 'benchmark-fixture',
  async *streamChat(messages, model, _credential, options) {
    if (options?.signal?.aborted) return
    const last = contentToText(messages.at(-1)!.content)
    let reply: string
    if (last.includes('impartial moderator')) {
      reply = '{"converged":false,"disagreements":[{"id":"I1","description":"Fixture tradeoff remains unresolved"}],"summary":"Synthetic disagreement."}'
      // The frozen parser expects strings.
      if (!last.includes('Previous unresolved issue inventory')) reply = '{"converged":false,"disagreements":["Fixture tradeoff remains unresolved"],"summary":"Synthetic disagreement."}'
    } else if (last.includes('THE final answer')) {
      reply = 'Synthetic fixture synthesis. This is harness verification, not a model answer.'
    } else if (last.includes('structured multi-agent debate')) {
      reply = last.includes('I1: Fixture tradeoff') ? 'STATUS {"disputed":["I1"],"newIssues":[]}\n## Revised Answer\nUNCHANGED'
        : `## Critique\nThe tradeoff is still disputed.\n## Revised Answer\n${model} fixture revised position`
    } else reply = `${model} fixture initial position`
    yield { type: 'text', delta: reply }
  }
}
