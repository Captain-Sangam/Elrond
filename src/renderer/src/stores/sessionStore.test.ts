import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentConfig,
  Message,
  ModeratorVerdictEvent,
  Session,
  StreamDone,
  StreamError,
  StreamStart,
  StreamToken,
  StreamToolEvent
} from '@shared/types'
import { useAgentsStore } from './agentsStore'
import { useSessionStore } from './sessionStore'

const startEvt = (over: Partial<StreamStart> = {}): StreamStart => ({
  agentId: 'a1',
  agentName: 'openai:gpt-4o',
  provider: 'openai',
  phase: 'initial',
  inputTokens: 100,
  ...over
})

const tokenEvt = (over: Partial<StreamToken> = {}): StreamToken => ({
  agentId: 'a1',
  agentName: 'openai:gpt-4o',
  provider: 'openai',
  delta: 'x',
  phase: 'initial',
  ...over
})

const doneEvt = (over: Partial<StreamDone> = {}): StreamDone => ({
  agentId: 'a1',
  agentName: 'openai:gpt-4o',
  provider: 'openai',
  fullContent: 'final content',
  tokenCount: 42,
  phase: 'initial',
  ...over
})

const errorEvt = (over: Partial<StreamError> = {}): StreamError => ({
  agentId: 'a1',
  agentName: 'openai:gpt-4o',
  provider: 'openai',
  message: 'boom',
  phase: 'initial',
  ...over
})

const toolEvt = (over: Partial<StreamToolEvent> = {}): StreamToolEvent => ({
  agentId: 'a1',
  agentName: 'openai:gpt-4o',
  provider: 'openai',
  phase: 'initial',
  callId: 'c1',
  toolName: 'search_issues',
  serverName: 'linear',
  status: 'running',
  ...over
})

const verdictEvt = (over: Partial<ModeratorVerdictEvent> = {}): ModeratorVerdictEvent => ({
  round: 1,
  maxRounds: 3,
  converged: false,
  disagreements: ['tabs vs spaces'],
  summary: 'still arguing',
  continuing: true,
  inputTokens: 100,
  outputTokens: 20,
  ...over
})

const messageFixture: Message = {
  id: 'm1',
  session_id: 'sess1',
  role: 'synthesis',
  agent_name: 'openai:gpt-4o',
  agent_id: 'a1',
  provider: 'openai',
  content: 'answer',
  token_count: 42,
  round: 0,
  created_at: '2026-07-17 12:00:00'
}

const sessionFixture: Session = {
  id: 'sess1',
  title: 'Test session',
  starred: false,
  repo_id: null,
  created_at: '2026-07-17 11:00:00',
  updated_at: '2026-07-17 12:00:00'
}

const openaiAgent: AgentConfig = {
  id: 'a1',
  name: 'openai:gpt-4o',
  provider: 'openai',
  model: 'gpt-4o',
  enabled: true
}

const makeElrond = (): {
  getMessages: ReturnType<typeof vi.fn>
  getSessions: ReturnType<typeof vi.fn>
  saveAgents: ReturnType<typeof vi.fn>
  setSetting: ReturnType<typeof vi.fn>
} => ({
  getMessages: vi.fn().mockResolvedValue([messageFixture]),
  getSessions: vi.fn().mockResolvedValue([sessionFixture]),
  saveAgents: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined)
})

let elrond: ReturnType<typeof makeElrond>

beforeEach(() => {
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useAgentsStore.setState(useAgentsStore.getInitialState(), true)
  elrond = makeElrond()
  vi.stubGlobal('window', { elrond })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('handleStreamStart', () => {
  it('records input tokens under phase:round:agentId, defaulting round to 0', () => {
    const { handleStreamStart } = useSessionStore.getState()
    handleStreamStart(startEvt({ inputTokens: 123 }))
    handleStreamStart(startEvt({ phase: 'debate', round: 2, inputTokens: 77 }))
    expect(useSessionStore.getState().callInputTokens).toEqual({
      'initial:0:a1': 123,
      'debate:2:a1': 77
    })
  })

  it('overwrites the estimate when the same call starts again', () => {
    const { handleStreamStart } = useSessionStore.getState()
    handleStreamStart(startEvt({ inputTokens: 10 }))
    handleStreamStart(startEvt({ inputTokens: 55 }))
    expect(useSessionStore.getState().callInputTokens['initial:0:a1']).toBe(55)
  })
})

describe('handleStreamToken', () => {
  it('accumulates initial-phase deltas per agent and marks the stream live', () => {
    const { handleStreamToken } = useSessionStore.getState()
    handleStreamToken(tokenEvt({ delta: 'Hel' }))
    handleStreamToken(tokenEvt({ delta: 'lo' }))
    handleStreamToken(tokenEvt({ agentId: 'a2', delta: 'Hi' }))

    const { agentStreams } = useSessionStore.getState()
    expect(agentStreams['a1']).toMatchObject({ content: 'Hello', isStreaming: true, error: null })
    expect(agentStreams['a2'].content).toBe('Hi')
  })

  it('creates debate rounds up to the token round and accumulates in that round', () => {
    const { handleStreamToken } = useSessionStore.getState()
    handleStreamToken(tokenEvt({ phase: 'debate', round: 2, delta: 'foo' }))
    handleStreamToken(tokenEvt({ phase: 'debate', round: 2, delta: 'bar' }))

    const { debateRounds } = useSessionStore.getState()
    expect(debateRounds.map((r) => r.round)).toEqual([1, 2])
    expect(debateRounds[0].streams).toEqual({})
    expect(debateRounds[1].streams['a1']).toMatchObject({ content: 'foobar', isStreaming: true })
  })

  it('defaults a debate token without a round to round 1', () => {
    useSessionStore.getState().handleStreamToken(tokenEvt({ phase: 'debate', delta: 'z' }))
    expect(useSessionStore.getState().debateRounds[0].streams['a1'].content).toBe('z')
  })

  it('appends synthesis deltas to the synthesis stream', () => {
    const { handleStreamToken } = useSessionStore.getState()
    handleStreamToken(tokenEvt({ phase: 'synthesis', delta: 'A' }))
    handleStreamToken(tokenEvt({ phase: 'synthesis', delta: 'B' }))
    expect(useSessionStore.getState().synthesisStream).toMatchObject({
      content: 'AB',
      isStreaming: true
    })
  })
})

describe('handleStreamDone', () => {
  it('replaces streamed content with fullContent but keeps tool chips (initial)', () => {
    const s = useSessionStore.getState()
    s.handleStreamTool(toolEvt())
    s.handleStreamToken(tokenEvt({ delta: 'partial' }))
    s.handleStreamDone(doneEvt())

    const stream = useSessionStore.getState().agentStreams['a1']
    expect(stream.content).toBe('final content')
    expect(stream.tokenCount).toBe(42)
    expect(stream.isStreaming).toBe(false)
    expect(stream.error).toBeNull()
    expect(stream.toolCalls).toHaveLength(1)
    expect(stream.toolCalls[0].callId).toBe('c1')
  })

  it('replaces the round stream content but keeps that round tool chips (debate)', () => {
    const s = useSessionStore.getState()
    s.handleStreamTool(toolEvt({ phase: 'debate', round: 1, callId: 'c9' }))
    s.handleStreamToken(tokenEvt({ phase: 'debate', round: 1, delta: 'draft' }))
    s.handleStreamDone(doneEvt({ phase: 'debate', round: 1, fullContent: 'rebuttal', tokenCount: 7 }))

    const stream = useSessionStore.getState().debateRounds[0].streams['a1']
    expect(stream).toMatchObject({ content: 'rebuttal', tokenCount: 7, isStreaming: false })
    expect(stream.toolCalls.map((c) => c.callId)).toEqual(['c9'])
  })

  it('resets the synthesis stream to a clean done state', () => {
    const s = useSessionStore.getState()
    s.handleStreamToken(tokenEvt({ phase: 'synthesis', delta: 'partial' }))
    s.handleStreamDone(doneEvt({ phase: 'synthesis', fullContent: 'the answer', tokenCount: 9 }))

    expect(useSessionStore.getState().synthesisStream).toEqual({
      content: 'the answer',
      tokenCount: 9,
      isStreaming: false,
      error: null,
      toolCalls: []
    })
  })
})

describe('handleStreamError', () => {
  it('wipes content and stores the error for initial-phase failures, keeping tool chips', () => {
    const s = useSessionStore.getState()
    s.handleStreamTool(toolEvt())
    s.handleStreamToken(tokenEvt({ delta: 'half an ans' }))
    s.handleStreamError(errorEvt({ message: 'rate limited' }))

    const stream = useSessionStore.getState().agentStreams['a1']
    expect(stream).toMatchObject({ content: '', tokenCount: 0, error: 'rate limited', isStreaming: false })
    expect(stream.toolCalls).toHaveLength(1)
  })

  it('keeps debate content and attaches the error to the right round', () => {
    const s = useSessionStore.getState()
    s.handleStreamToken(tokenEvt({ phase: 'debate', round: 2, delta: 'so far' }))
    s.handleStreamError(errorEvt({ phase: 'debate', round: 2, message: 'timeout' }))

    const stream = useSessionStore.getState().debateRounds[1].streams['a1']
    expect(stream).toMatchObject({ content: 'so far', error: 'timeout', isStreaming: false })
  })

  it('keeps synthesis content and attaches the error to the synthesis stream', () => {
    const s = useSessionStore.getState()
    s.handleStreamToken(tokenEvt({ phase: 'synthesis', delta: 'partial synth' }))
    s.handleStreamError(errorEvt({ phase: 'synthesis', message: 'overloaded' }))

    expect(useSessionStore.getState().synthesisStream).toMatchObject({
      content: 'partial synth',
      error: 'overloaded',
      isStreaming: false
    })
  })
})

describe('handleStreamTool', () => {
  it('upserts chips by callId: running then ok merges into one chip', () => {
    const s = useSessionStore.getState()
    s.handleStreamTool(toolEvt({ argsPreview: '{"q":"bug"}' }))
    let chips = useSessionStore.getState().agentStreams['a1'].toolCalls
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ callId: 'c1', status: 'running', argsPreview: '{"q":"bug"}' })

    s.handleStreamTool(
      toolEvt({ status: 'ok', argsPreview: '{"q":"bug"}', resultPreview: '3 issues', durationMs: 120 })
    )
    chips = useSessionStore.getState().agentStreams['a1'].toolCalls
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ status: 'ok', resultPreview: '3 issues', durationMs: 120 })
  })

  it('appends a new chip for a different callId and records errors', () => {
    const s = useSessionStore.getState()
    s.handleStreamTool(toolEvt({ callId: 'c1' }))
    s.handleStreamTool(toolEvt({ callId: 'c2', status: 'error', errorMessage: 'denied' }))

    const chips = useSessionStore.getState().agentStreams['a1'].toolCalls
    expect(chips.map((c) => c.callId)).toEqual(['c1', 'c2'])
    expect(chips[1]).toMatchObject({ status: 'error', errorMessage: 'denied' })
  })

  it('routes debate tool events into the round stream', () => {
    useSessionStore.getState().handleStreamTool(toolEvt({ phase: 'debate', round: 2 }))
    const { debateRounds } = useSessionStore.getState()
    expect(debateRounds).toHaveLength(2)
    expect(debateRounds[1].streams['a1'].toolCalls.map((c) => c.callId)).toEqual(['c1'])
  })

  it('ignores synthesis-phase tool events', () => {
    const before = useSessionStore.getState()
    useSessionStore.getState().handleStreamTool(toolEvt({ phase: 'synthesis' }))
    const after = useSessionStore.getState()
    expect(after.agentStreams).toEqual(before.agentStreams)
    expect(after.debateRounds).toEqual(before.debateRounds)
    expect(after.synthesisStream.toolCalls).toEqual([])
  })
})

describe('handlePhaseChange', () => {
  it('tracks debate round bookkeeping', () => {
    const s = useSessionStore.getState()
    s.handlePhaseChange({ phase: 'debate', round: 1, maxRounds: 3 })

    let state = useSessionStore.getState()
    expect(state.currentPhase).toBe('debate')
    expect(state.currentRound).toBe(1)
    expect(state.maxRounds).toBe(3)
    expect(state.debateRounds).toHaveLength(1)
    expect(state.debateRounds[0]).toMatchObject({ round: 1, moderating: false, verdict: null })

    s.handlePhaseChange({ phase: 'moderating', round: 1 })
    state = useSessionStore.getState()
    expect(state.currentPhase).toBe('moderating')
    expect(state.debateRounds[0].moderating).toBe(true)
    // round/maxRounds untouched when the event omits them
    expect(state.currentRound).toBe(1)
    expect(state.maxRounds).toBe(3)
  })

  it('on complete: stamps the end time, reloads messages, then clears the live turn', async () => {
    useSessionStore.setState({
      activeSessionId: 'sess1',
      isDeliberating: true,
      currentPhase: 'synthesis',
      currentPrompt: 'why?',
      currentAttachments: [{ fileName: 'a.png', mimeType: 'image/png', previewUrl: null }]
    })

    useSessionStore.getState().handlePhaseChange({ phase: 'complete' })

    // End timestamp lands synchronously, before the async message reload
    expect(useSessionStore.getState().deliberationEndedAt).not.toBeNull()

    await vi.waitFor(() => {
      expect(useSessionStore.getState().isDeliberating).toBe(false)
    })
    const state = useSessionStore.getState()
    expect(elrond.getMessages).toHaveBeenCalledWith('sess1')
    expect(state.messages).toEqual([messageFixture])
    expect(state.currentPhase).toBeNull()
    expect(state.currentPrompt).toBeNull()
    expect(state.currentAttachments).toEqual([])
  })
})

describe('handleModeratorVerdict', () => {
  it('stores the verdict and moderator tokens on the round and updates maxRounds', () => {
    const s = useSessionStore.getState()
    s.handlePhaseChange({ phase: 'moderating', round: 2 })
    expect(useSessionStore.getState().debateRounds[1].moderating).toBe(true)

    s.handleModeratorVerdict(verdictEvt({ round: 2, maxRounds: 5, converged: true, continuing: false }))

    const state = useSessionStore.getState()
    expect(state.maxRounds).toBe(5)
    const round = state.debateRounds[1]
    expect(round.moderating).toBe(false)
    expect(round.verdict).toEqual({
      converged: true,
      disagreements: ['tabs vs spaces'],
      summary: 'still arguing',
      continuing: false
    })
    expect(round.moderatorTokens).toEqual({ input: 100, output: 20 })
  })

  it('creates missing rounds when the verdict arrives before any round events', () => {
    useSessionStore.getState().handleModeratorVerdict(verdictEvt({ round: 2 }))
    const { debateRounds } = useSessionStore.getState()
    expect(debateRounds.map((r) => r.round)).toEqual([1, 2])
    expect(debateRounds[1].verdict).not.toBeNull()
    expect(debateRounds[0].verdict).toBeNull()
  })
})

describe('startDeliberation', () => {
  it('starts a fresh turn without archiving when nothing ran before', () => {
    useSessionStore.getState().startDeliberation('first question')
    const state = useSessionStore.getState()
    expect(state.turnStats).toEqual([])
    expect(state.isDeliberating).toBe(true)
    expect(state.currentPhase).toBe('initial')
    expect(state.currentPrompt).toBe('first question')
    expect(state.deliberationStartedAt).toEqual(expect.any(Number))
    expect(state.deliberationEndedAt).toBeNull()
  })

  it('archives the previous turn stats and resets the live state', () => {
    useAgentsStore.setState({ agents: [openaiAgent], synthesizerAgentId: 'a1' })
    const s = useSessionStore.getState()
    s.handleStreamStart(startEvt({ inputTokens: 100 }))
    s.handleStreamDone(doneEvt({ fullContent: 'x'.repeat(40), tokenCount: 10 }))
    s.handlePhaseChange({ phase: 'debate', round: 1, maxRounds: 3 })
    s.handleModeratorVerdict(verdictEvt({ round: 1, converged: true, continuing: false }))
    useSessionStore.setState({ deliberationStartedAt: 1000, deliberationEndedAt: 5000 })

    useSessionStore.getState().startDeliberation('follow-up')

    const state = useSessionStore.getState()
    expect(state.turnStats).toHaveLength(1)
    const archived = state.turnStats[0]
    // initial: 100 in (from stream start), 10 out (40 chars / 4);
    // round 1 adds the moderator's 100 in / 20 out, billed at gpt-4o rates
    expect(archived).toMatchObject({
      turn: 1,
      input: 200,
      output: 30,
      elapsedMs: 4000,
      rounds: 1,
      converged: true
    })
    expect(archived.cost).toBeCloseTo(0.0025 * 0.2 + 0.01 * 0.03, 10)

    // Live state was wiped for the new turn, but the archive survives
    expect(state.agentStreams).toEqual({})
    expect(state.debateRounds).toEqual([])
    expect(state.callInputTokens).toEqual({})
    expect(state.isDeliberating).toBe(true)
    expect(state.currentPrompt).toBe('follow-up')
    expect(state.deliberationEndedAt).toBeNull()
  })

  it('skips archiving a turn that produced no tokens', () => {
    useAgentsStore.setState({ agents: [openaiAgent], synthesizerAgentId: 'a1' })
    useSessionStore.setState({ deliberationStartedAt: 1000, deliberationEndedAt: 2000 })

    useSessionStore.getState().startDeliberation('retry')

    expect(useSessionStore.getState().turnStats).toEqual([])
  })
})

describe('endDeliberation', () => {
  it('clears the live-turn flags and stamps the end time exactly once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    useSessionStore.setState({
      isDeliberating: true,
      currentPhase: 'debate',
      currentPrompt: 'q',
      deliberationStartedAt: 90_000
    })

    useSessionStore.getState().endDeliberation()
    let state = useSessionStore.getState()
    expect(state.isDeliberating).toBe(false)
    expect(state.currentPhase).toBeNull()
    expect(state.currentPrompt).toBeNull()
    expect(state.deliberationEndedAt).toBe(100_000)

    // A second call (e.g. cancel after complete) must not move the clock
    vi.setSystemTime(200_000)
    useSessionStore.getState().endDeliberation()
    expect(useSessionStore.getState().deliberationEndedAt).toBe(100_000)
  })
})
