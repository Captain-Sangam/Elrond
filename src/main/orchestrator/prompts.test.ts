import { describe, expect, it } from 'vitest'
import {
  getDebateRoundPrompt,
  getModeratorPrompt,
  getSynthesisPrompt,
  parseModeratorVerdict,
  splitDebateResponse
} from './prompts'

describe('splitDebateResponse', () => {
  it('splits a well-formed critique + revised answer response', () => {
    const content =
      '## Critique\nAgent B ignores caching entirely.\n\n## Revised Answer\nUse Redis.\nSet a TTL.'
    expect(splitDebateResponse(content)).toEqual({
      critique: 'Agent B ignores caching entirely.',
      revised: 'Use Redis.\nSet a TTL.'
    })
  })

  it('treats the whole response as the revised answer when the header is missing', () => {
    const content = '  I simply think the answer is 42, my Revised Answer: 42.  '
    expect(splitDebateResponse(content)).toEqual({
      critique: '',
      revised: 'I simply think the answer is 42, my Revised Answer: 42.'
    })
  })

  it('matches the revised-answer header case-insensitively', () => {
    const content = '## critique\nWeak reasoning from B.\n\n## REVISED ANSWER\nParis.'
    expect(splitDebateResponse(content)).toEqual({
      critique: 'Weak reasoning from B.',
      revised: 'Paris.'
    })
  })

  it('falls back to the whole trimmed content when the revised section is empty', () => {
    const content = '## Critique\nNo issues found.\n\n## Revised Answer\n   \n'
    const result = splitDebateResponse(content)
    expect(result.critique).toBe('No issues found.')
    expect(result.revised).toBe(content.trim())
  })

  it('strips the ## Critique header from the critique section', () => {
    const content = '## Critique\nYou are wrong about X.\n\n## Revised Answer\nY.'
    const result = splitDebateResponse(content)
    expect(result.critique).toBe('You are wrong about X.')
    expect(result.critique).not.toContain('##')
  })

  it('requires the revised header to sit on its own line', () => {
    const content = 'Intro. ## Revised Answer inline mention\nBody text.'
    expect(splitDebateResponse(content)).toEqual({ critique: '', revised: content.trim() })
  })
})

describe('parseModeratorVerdict', () => {
  it('assigns stable IDs to a first disagreement inventory', () => {
    expect(parseModeratorVerdict('{"converged":false,"disagreements":["scaling"],"summary":"Open."}')).toEqual({
      converged: false, disagreements: ['I1: scaling'], issues: [{ id: 'I1', description: 'scaling' }], summary: 'Open.'
    })
  })
  it('preserves IDs for reworded and reordered issues and never recycles a resolved ID', () => {
    const history = [{ id: 'I1', description: 'pricing' }, { id: 'I2', description: 'scaling' }]
    const result = parseModeratorVerdict('{"converged":false,"disagreements":[{"id":"I2","description":"Scaling under load"},{"description":"privacy"}],"summary":"Open."}', [history[1]], history)
    expect(result.issues).toEqual([{ id: 'I2', description: 'Scaling under load' }, { id: 'I3', description: 'privacy' }])
  })
  it('accepts valid fenced JSON and surrounding prose', () => {
    expect(parseModeratorVerdict('Here: ```json\n{"converged":true,"disagreements":[],"summary":"Resolved."}\n```').converged).toBe(true)
  })
  it.each([
    'not JSON', '{converged: yes}', '{"converged":"false","disagreements":[]}',
    '{"disagreements":[]}', '{"converged":0,"disagreements":[]}',
    '{"converged":false,"disagreements":"pricing"}',
    '{"converged":true,"disagreements":["pricing"]}',
    '{"converged":false,"disagreements":[]}',
    '{"converged":false,"disagreements":[null]}',
    '{"converged":false,"disagreements":[{"description":""}]}',
    '{"converged":false,"disagreements":[{"id":"I1","description":"pricing"},{"id":"I1","description":"different"}]}'
  ])('fails without claiming agreement, preserving open issues: %s', (raw) => {
    const prior = [{ id: 'I1', description: 'pricing' }]
    expect(parseModeratorVerdict(raw, prior)).toMatchObject({ converged: false, parseFailed: true, issues: prior, disagreements: ['I1: pricing'] })
  })
})

describe('getDebateRoundPrompt', () => {
  it('uses round-1 wording without the previous-round critiques phrase', () => {
    const prompt = getDebateRoundPrompt('Claude', 1, 'The answer is 42.', [
      { name: 'GPT', position: 'It is 41.', critique: null }
    ])
    expect(prompt).toContain('You are Claude in round 1 of a structured multi-agent debate')
    expect(prompt).toContain('Your current position:\nThe answer is 42.')
    expect(prompt).toContain("The other agents' current positions:")
    expect(prompt).not.toContain('and their critiques from the previous round')
  })

  it('mentions previous-round critiques for rounds after the first', () => {
    const prompt = getDebateRoundPrompt('Claude', 2, 'pos', [
      { name: 'GPT', position: 'p1', critique: 'You missed X.' }
    ])
    expect(prompt).toContain('You are Claude in round 2')
    expect(prompt).toContain(
      "The other agents' current positions and their critiques from the previous round:"
    )
  })

  it('includes opponent names and positions, and critique sections only when present', () => {
    const prompt = getDebateRoundPrompt('Claude', 2, 'pos', [
      { name: 'GPT', position: 'p1', critique: 'You missed X.' },
      { name: 'Gemini', position: 'p2', critique: null }
    ])
    expect(prompt).toContain(
      '### GPT — Current Position\np1\n\n### GPT — Critique from the Previous Round\nYou missed X.\n\n### Gemini — Current Position\np2'
    )
    expect(prompt).not.toContain('### Gemini — Critique from the Previous Round')
  })
})

describe('getModeratorPrompt', () => {
  it('lists every agent position under its name', () => {
    const prompt = getModeratorPrompt(
      'What is 2+2?',
      [
        { name: 'Agent A', position: '4' },
        { name: 'Agent B', position: 'four' }
      ],
      1
    )
    expect(prompt).toContain('User question:\nWhat is 2+2?')
    expect(prompt).toContain('### Agent A\n4\n\n### Agent B\nfour')
  })

  it('states which round just finished', () => {
    const prompt = getModeratorPrompt('q', [{ name: 'A', position: 'p' }], 3)
    expect(prompt).toContain('Round 3 has just finished.')
  })
})

describe('getSynthesisPrompt', () => {
  it('renders the non-debated variant with plain Response sections', () => {
    const prompt = getSynthesisPrompt(
      'Best database?',
      [
        { name: 'A', initial: 'Postgres, obviously.', final: 'SQLite.' },
        { name: 'B', initial: 'MySQL.', final: 'MySQL.' }
      ],
      []
    )
    expect(prompt).toContain('User question:\nBest database?')
    // With no debate rounds, final-vs-initial differences are ignored
    expect(prompt).toContain('### A\n**Response:**\nSQLite.')
    expect(prompt).toContain('### B\n**Response:**\nMySQL.')
    expect(prompt).not.toContain('Initial Response')
    expect(prompt).not.toContain(', then debated and revised their positions')
    expect(prompt).not.toContain('The agents debated for')
  })

  it('shows initial and final positions for agents that changed during debate', () => {
    const prompt = getSynthesisPrompt(
      'q',
      [{ name: 'A', initial: 'old take', final: 'new take' }],
      [{ round: 1, disagreements: [] }]
    )
    expect(prompt).toContain(', then debated and revised their positions')
    expect(prompt).toContain(
      '### A\n**Initial Response:**\nold take\n\n**Final Revised Position (after debate):**\nnew take'
    )
  })

  it('uses the plain Response section when a debated agent kept its initial answer', () => {
    const prompt = getSynthesisPrompt(
      'q',
      [
        { name: 'A', initial: 'unchanged', final: 'unchanged' },
        { name: 'B', initial: 'x', final: 'y' }
      ],
      [{ round: 1, disagreements: ['detail'] }]
    )
    expect(prompt).toContain('### A\n**Response:**\nunchanged')
    expect(prompt).not.toContain('### A\n**Initial Response:**')
    // sections are separated by a horizontal rule
    expect(prompt).toContain('\n\n---\n\n')
  })

  it('formats round summaries with and without disagreements', () => {
    const prompt = getSynthesisPrompt(
      'q',
      [{ name: 'A', initial: 'i', final: 'f' }],
      [
        { round: 1, disagreements: ['caching', 'pricing'] },
        { round: 2, disagreements: [] }
      ]
    )
    expect(prompt).toContain('The agents debated for 2 round(s).')
    expect(prompt).toContain('- Round 1: unresolved disagreements — caching; pricing')
    expect(prompt).toContain('- Round 2: no substantive disagreements remained')
  })
})

describe('focused issue reports', () => {
  it('includes the prior inventory and structured status instructions', () => {
    const issues = [{ id: 'I7', description: 'Cache TTL' }]
    expect(getDebateRoundPrompt('A', 2, 'answer', [], issues)).toContain('I7: Cache TTL')
    expect(getDebateRoundPrompt('A', 2, 'answer', [], issues)).toContain('STATUS {')
    expect(getModeratorPrompt('q', [], 2, issues)).toContain('Keep each existing issue')
  })
  it('recognizes whole-response and revised-section UNCHANGED without swallowing ordinary text', () => {
    expect(splitDebateResponse(' UNCHANGED ')).toMatchObject({ unchanged: true })
    expect(splitDebateResponse('STATUS {"disputed":["I1"],"newIssues":[]}\n## Critique\nStill disagree.\n## Revised Answer\nUNCHANGED')).toEqual({ critique: 'Still disagree.', revised: 'UNCHANGED', unchanged: true, status: { disputed: ['I1'], newIssues: [] } })
    expect(splitDebateResponse('The answer is UNCHANGED in this scenario.').unchanged).toBeUndefined()
  })
  it('keeps failed moderation distinct from no remaining disagreements in synthesis', () => {
    const prompt = getSynthesisPrompt('q', [{ name: 'A', initial: 'a', final: 'a' }], [{ round: 1, disagreements: [], terminationReason: 'degraded' }])
    expect(prompt).toContain('agreement was not established')
    expect(prompt).not.toContain('no substantive disagreements remained')
  })
})
