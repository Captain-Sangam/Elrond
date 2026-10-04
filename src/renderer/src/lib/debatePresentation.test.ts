import { describe, expect, it } from 'vitest'
import { describeIssueReport, presentDebateResponse } from './debatePresentation'

describe('debate presentation', () => {
  it('turns protocol metadata into a report and keeps the Markdown answer', () => {
    const answer = '## Critique\nA useful point.\n\n## Revised Answer\nThe answer.'
    expect(presentDebateResponse(`STATUS {"disputed":["I1"],"newIssues":["A new point"]}\n${answer}`)).toEqual({ body: answer, report: { disputed: ['I1'], newIssues: ['A new point'] } })
  })
  it.each(['S', 'STAT', 'STATUS', 'STATUS ', 'STATUS {"disputed": [', 'STATUS {\n\n"disputed": ["I1"],'])('does not flash partial metadata while streaming: %s', (content) => {
    expect(presentDebateResponse(content, true).body).toBe('')
  })
  it('supports multiline JSON and braces/escaped quotes within issue descriptions', () => {
    const report = { disputed: ['I1'], newIssues: ['Check {rules} and "quotes"'] }
    expect(presentDebateResponse(`STATUS ${JSON.stringify(report, null, 2)}\n\nAnswer.`)).toEqual({ body: 'Answer.', report })
  })
  it('hides malformed protocol without hiding the following answer', () => {
    expect(presentDebateResponse('STATUS {broken}\n## Critique\nUseful text.')).toEqual({ body: '## Critique\nUseful text.', report: null })
    expect(presentDebateResponse('STATUS {"disputed": [\n## Critique\nUseful text.').body).toBe('## Critique\nUseful text.')
    expect(presentDebateResponse('STATUS {"disputed": 2, "newIssues": []}\nAnswer.').body).toBe('Answer.')
  })
  it('preserves ordinary responses, quoted protocol examples and STATUS prose', () => {
    for (const body of ['Normal answer.', 'STATUS updates are expected.', '```\nSTATUS {"disputed":[],"newIssues":[]}\n```', 'A quoted STATUS {"disputed":[]} line.']) {
      expect(presentDebateResponse(body)).toEqual({ body, report: null })
    }
  })
  it('deduplicates issue reports and describes them without implying agreement', () => {
    const result = presentDebateResponse('STATUS {"disputed":["I1"," I1 ",""],"newIssues":[]}\nAnswer.')
    expect(describeIssueReport(result.report!)).toBe('1 open issue')
    expect(describeIssueReport({ disputed: [], newIssues: [] })).toBe('No issues raised')
    expect(describeIssueReport({ disputed: ['I1', 'I2'], newIssues: ['New'] })).toBe('2 open issues · 1 new point')
  })
})
