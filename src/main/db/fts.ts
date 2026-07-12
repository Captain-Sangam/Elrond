// Natural-language text cannot go into an FTS5 MATCH clause raw: characters
// like '-', '.', ':' are query syntax (e.g. "one-line" parses as a column
// filter and throws "no such column"). Reduce the text to quoted word terms.
export function toFtsQuery(text: string, mode: 'any' | 'all' = 'any'): string {
  const words = text.match(/[A-Za-z0-9_]{2,}/g) ?? []
  const unique = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 12)
  return unique.map((w) => `"${w}"`).join(mode === 'any' ? ' OR ' : ' AND ')
}
