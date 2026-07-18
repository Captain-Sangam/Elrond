import { describe, expect, it } from 'vitest'
import { toFtsQuery } from './fts'

describe('toFtsQuery', () => {
  it('splits on punctuation and hyphens into quoted terms', () => {
    expect(toFtsQuery('one-line')).toBe('"one" OR "line"')
    expect(toFtsQuery('foo.bar:baz')).toBe('"foo" OR "bar" OR "baz"')
  })

  it('treats underscores and digits as word characters', () => {
    expect(toFtsQuery('snake_case_name')).toBe('"snake_case_name"')
    expect(toFtsQuery('error 404 codes')).toBe('"error" OR "404" OR "codes"')
  })

  it('drops words shorter than two characters', () => {
    expect(toFtsQuery('a I x hello 7')).toBe('"hello"')
  })

  it('dedupes case-insensitively, keeping first-seen order and lowercasing', () => {
    expect(toFtsQuery('Hello WORLD hello world HELLO')).toBe('"hello" OR "world"')
  })

  it('caps the output at 12 terms', () => {
    const words = Array.from({ length: 15 }, (_, i) => `word${i}`)
    const result = toFtsQuery(words.join(' '))
    expect(result.split(' OR ')).toHaveLength(12)
    expect(result).toBe(words.slice(0, 12).map((w) => `"${w}"`).join(' OR '))
  })

  it('dedupes before applying the 12-term cap, so duplicates do not consume slots', () => {
    const uniques = [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo',
      'foxtrot',
      'golf',
      'hotel',
      'india',
      'juliet',
      'kilo',
      'lima'
    ]
    const input = 'dup dup dup dup ' + uniques.join(' ')
    const result = toFtsQuery(input)
    expect(result.split(' OR ')).toHaveLength(12)
    expect(result).toBe(
      ['dup', ...uniques.slice(0, 11)].map((w) => `"${w}"`).join(' OR ')
    )
  })

  it("defaults to 'any' mode (OR)", () => {
    expect(toFtsQuery('red green')).toBe('"red" OR "green"')
  })

  it("joins with AND in 'all' mode", () => {
    expect(toFtsQuery('red green blue', 'all')).toBe('"red" AND "green" AND "blue"')
    expect(toFtsQuery('solo', 'all')).toBe('"solo"')
  })

  it('returns the empty string for empty input', () => {
    expect(toFtsQuery('')).toBe('')
  })

  it('returns the empty string for symbols-only input', () => {
    expect(toFtsQuery('--- !!! ??? ... :: //')).toBe('')
    expect(toFtsQuery('- . :', 'all')).toBe('')
  })
})
