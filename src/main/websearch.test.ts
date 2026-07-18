import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatWebResults, searchWeb, testWebSearchKey, type WebResult } from './websearch'
import { getApiKey } from './keychain'

vi.mock('./keychain', () => ({
  getApiKey: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  findCredentialAccounts: vi.fn()
}))

const getApiKeyMock = vi.mocked(getApiKey)
const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  getApiKeyMock.mockResolvedValue('tvly-test-key')
})

describe('searchWeb', () => {
  it('throws the settings-error message when no API key is configured', async () => {
    getApiKeyMock.mockResolvedValue(null)
    await expect(searchWeb('anything')).rejects.toThrow(
      'No Tavily API key configured — add one in Settings → Web Search'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the query to the Tavily endpoint with the key as a bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))
    await searchWeb('electron testing')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.tavily.com/search')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tvly-test-key',
      'Content-Type': 'application/json'
    })
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'electron testing',
      max_results: 8
    })
  })

  it.each([401, 403])('throws the invalid-key error on HTTP %d', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({}, status))
    await expect(searchWeb('q')).rejects.toThrow('Tavily API key is invalid')
  })

  it.each([429, 432])('throws the rate/usage-limit error on HTTP %d', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({}, status))
    await expect(searchWeb('q')).rejects.toThrow('Tavily rate/usage limit hit — try again later')
  })

  it('includes the status code in the error for other non-ok responses', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500))
    await expect(searchWeb('q')).rejects.toThrow('Tavily search failed (500)')
  })

  it('filters out results missing title or url and defaults missing content to empty string', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          { title: 'Complete', url: 'https://a.example', content: 'Alpha' },
          { url: 'https://no-title.example', content: 'dropped' },
          { title: 'No URL', content: 'dropped' },
          { title: 'No content', url: 'https://b.example' }
        ]
      })
    )

    await expect(searchWeb('q')).resolves.toEqual([
      { title: 'Complete', url: 'https://a.example', content: 'Alpha' },
      { title: 'No content', url: 'https://b.example', content: '' }
    ])
  })

  it('returns an empty array when the response has no results field', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await expect(searchWeb('q')).resolves.toEqual([])
  })
})

describe('formatWebResults', () => {
  it('numbers each result under the header with title, URL, and content lines', () => {
    const results: WebResult[] = [
      { title: 'First', url: 'https://a.example', content: 'Alpha' },
      { title: 'Second', url: 'https://b.example', content: 'Beta' }
    ]
    const out = formatWebResults(results)

    expect(out.startsWith('## Web Search Results\n')).toBe(true)
    expect(out).toContain('### 1. First\nhttps://a.example\nAlpha')
    expect(out).toContain('### 2. Second\nhttps://b.example\nBeta')
  })

  it('still renders the header block for empty results, with no numbered sections', () => {
    const out = formatWebResults([])
    expect(out).toContain('## Web Search Results')
    expect(out).toContain('cite sources by name and URL')
    expect(out).not.toContain('###')
  })
})

describe('testWebSearchKey', () => {
  it('returns true when the probe request succeeds', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))
    await expect(testWebSearchKey('tvly-abc')).resolves.toBe(true)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tvly-abc' })
    expect(JSON.parse(init.body as string)).toEqual({ query: 'test', max_results: 1 })
  })

  it('returns false on a non-ok response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401))
    await expect(testWebSearchKey('bad')).resolves.toBe(false)
  })

  it('returns false when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(testWebSearchKey('any')).resolves.toBe(false)
  })
})
