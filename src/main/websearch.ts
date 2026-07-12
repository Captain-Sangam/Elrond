import { getApiKey } from './keychain'

export interface WebResult {
  title: string
  url: string
  content: string
}

interface TavilyResponse {
  results?: {
    title?: string
    url?: string
    content?: string
  }[]
}

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

async function tavilyFetch(query: string, maxResults: number, key: string): Promise<Response> {
  return fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, max_results: maxResults })
  })
}

export async function searchWeb(query: string, count = 8): Promise<WebResult[]> {
  const key = await getApiKey('tavily')
  if (!key) {
    throw new Error('No Tavily API key configured — add one in Settings → Web Search')
  }

  const res = await tavilyFetch(query, count, key)
  if (res.status === 401 || res.status === 403) {
    throw new Error('Tavily API key is invalid')
  }
  if (res.status === 429 || res.status === 432) {
    throw new Error('Tavily rate/usage limit hit — try again later')
  }
  if (!res.ok) {
    throw new Error(`Tavily search failed (${res.status})`)
  }

  const data = (await res.json()) as TavilyResponse
  return (data.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      content: r.content ?? ''
    }))
}

export function formatWebResults(results: WebResult[]): string {
  const sections = results
    .map((r, i) => `### ${i + 1}. ${r.title}\n${r.url}\n${r.content}`)
    .join('\n\n')

  return `## Web Search Results

The following live web results were retrieved for this question. Use them for up-to-date facts and cite sources by name and URL when you rely on them.

${sections}`
}

export async function testWebSearchKey(key: string): Promise<boolean> {
  try {
    const res = await tavilyFetch('test', 1, key)
    return res.ok
  } catch {
    return false
  }
}
