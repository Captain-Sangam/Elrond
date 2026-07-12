import { getApiKey } from './keychain'

export interface WebResult {
  title: string
  url: string
  description: string
  extraSnippets?: string[]
}

interface BraveResponse {
  web?: {
    results?: {
      title?: string
      url?: string
      description?: string
      extra_snippets?: string[]
    }[]
  }
}

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

async function braveFetch(query: string, count: number, key: string): Promise<Response> {
  const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}`
  return fetch(url, {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' }
  })
}

export async function searchWeb(query: string, count = 8): Promise<WebResult[]> {
  const key = await getApiKey('brave')
  if (!key) {
    throw new Error('No Brave Search API key configured — add one in Settings → Web Search')
  }

  const res = await braveFetch(query, count, key)
  if (res.status === 401 || res.status === 403) {
    throw new Error('Brave Search API key is invalid')
  }
  if (res.status === 429) {
    throw new Error('Brave Search rate limit hit — try again in a moment')
  }
  if (!res.ok) {
    throw new Error(`Brave Search failed (${res.status})`)
  }

  const data = (await res.json()) as BraveResponse
  return (data.web?.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      description: r.description ?? '',
      extraSnippets: r.extra_snippets
    }))
}

export function formatWebResults(results: WebResult[]): string {
  const sections = results
    .map((r, i) => {
      let section = `### ${i + 1}. ${r.title}\n${r.url}\n${r.description}`
      if (r.extraSnippets?.length) {
        section += `\n${r.extraSnippets.join('\n')}`
      }
      return section
    })
    .join('\n\n')

  return `## Web Search Results

The following live web results were retrieved for this question. Use them for up-to-date facts and cite sources by name and URL when you rely on them.

${sections}`
}

export async function testBraveKey(key: string): Promise<boolean> {
  try {
    const res = await braveFetch('test', 1, key)
    return res.ok
  } catch {
    return false
  }
}
