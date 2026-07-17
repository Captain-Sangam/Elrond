import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OLLAMA_BASE_URL,
  listOllamaModels,
  normalizeBaseUrl,
  testOllamaConnection
} from './ollama'

function stubFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('normalizeBaseUrl', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  http://myhost:1234  ')).toBe('http://myhost:1234')
  })

  it('strips trailing slashes', () => {
    expect(normalizeBaseUrl('http://myhost:1234/')).toBe('http://myhost:1234')
    expect(normalizeBaseUrl('http://myhost:1234///')).toBe('http://myhost:1234')
  })

  it('falls back to the default localhost URL when empty or blank', () => {
    expect(normalizeBaseUrl('')).toBe(DEFAULT_OLLAMA_BASE_URL)
    expect(normalizeBaseUrl('   ')).toBe(DEFAULT_OLLAMA_BASE_URL)
    expect(DEFAULT_OLLAMA_BASE_URL).toBe('http://localhost:11434')
  })

  it('leaves an already-normalized URL untouched', () => {
    expect(normalizeBaseUrl('http://myhost:1234')).toBe('http://myhost:1234')
  })
})

describe('listOllamaModels', () => {
  it('returns model names sorted alphabetically', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({ models: [{ name: 'zeta:latest' }, { name: 'alpha:7b' }, { name: 'mid:1b' }] })
    )

    await expect(listOllamaModels('http://myhost:1234')).resolves.toEqual([
      'alpha:7b',
      'mid:1b',
      'zeta:latest'
    ])
  })

  it('hits /api/tags on the normalized base URL with a timeout signal', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ models: [] }))

    await listOllamaModels('  http://myhost:9999///  ')

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://myhost:9999/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('uses the default base URL when given an empty string', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ models: [] }))

    await listOllamaModels('')

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags')
  })

  it('throws with the status code on a non-ok response', async () => {
    stubFetch().mockResolvedValue(jsonResponse({}, 500))

    await expect(listOllamaModels('http://myhost:1234')).rejects.toThrow('Ollama returned 500')
  })

  it('returns an empty list when the models field is missing', async () => {
    stubFetch().mockResolvedValue(jsonResponse({}))

    await expect(listOllamaModels('http://myhost:1234')).resolves.toEqual([])
  })

  it('propagates network errors', async () => {
    stubFetch().mockRejectedValue(new TypeError('fetch failed'))

    await expect(listOllamaModels('http://myhost:1234')).rejects.toThrow('fetch failed')
  })
})

describe('testOllamaConnection', () => {
  it('returns true when /api/tags responds with a models array', async () => {
    stubFetch().mockResolvedValue(jsonResponse({ models: [] }))

    await expect(testOllamaConnection('http://myhost:1234')).resolves.toBe(true)
  })

  it('returns false when models is not an array', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: 'nope' }))
    await expect(testOllamaConnection('http://myhost:1234')).resolves.toBe(false)

    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await expect(testOllamaConnection('http://myhost:1234')).resolves.toBe(false)
  })

  it('returns false on a non-ok response', async () => {
    stubFetch().mockResolvedValue(jsonResponse({ models: [] }, 503))

    await expect(testOllamaConnection('http://myhost:1234')).resolves.toBe(false)
  })

  it('returns false when the body is not valid JSON', async () => {
    stubFetch().mockResolvedValue(new Response('<html>not json</html>', { status: 200 }))

    await expect(testOllamaConnection('http://myhost:1234')).resolves.toBe(false)
  })

  it('returns false when fetch rejects', async () => {
    stubFetch().mockRejectedValue(new TypeError('fetch failed'))

    await expect(testOllamaConnection('http://myhost:1234')).resolves.toBe(false)
  })

  it('normalizes the base URL before connecting', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ models: [] }))

    await testOllamaConnection('  http://myhost:4321/  ')

    expect(fetchMock.mock.calls[0][0]).toBe('http://myhost:4321/api/tags')
  })
})
