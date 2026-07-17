import { afterEach, describe, expect, it, vi } from 'vitest'
import { estimateCost, formatBytes, formatCost, formatRelativeTime, formatTokens } from './utils'

describe('formatTokens', () => {
  it('returns numbers below 1000 as-is', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(1)).toBe('1')
    expect(formatTokens(999)).toBe('999')
  })

  it('formats thousands with one decimal and a k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(12_345)).toBe('12.3k')
  })

  it('rounds values just under a million into the k branch', () => {
    // 999_999 is below the 1M threshold, so it stays in the k branch
    expect(formatTokens(999_999)).toBe('1000.0k')
  })

  it('formats millions with one decimal and an M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })
})

describe('formatBytes', () => {
  it('formats values below 1 KiB as bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats KiB range with no decimals', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('2 KB') // toFixed(0) rounds
    expect(formatBytes(10 * 1024)).toBe('10 KB')
  })

  it('formats MiB range with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB')
  })
})

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const freeze = (iso: string): void => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('returns "Just now" under one minute', () => {
    freeze('2026-07-17T12:00:00Z')
    expect(formatRelativeTime('2026-07-17T11:59:30Z')).toBe('Just now')
    expect(formatRelativeTime('2026-07-17T12:00:00Z')).toBe('Just now')
  })

  it('returns minutes under an hour', () => {
    freeze('2026-07-17T12:00:00Z')
    expect(formatRelativeTime('2026-07-17T11:55:00Z')).toBe('5m ago')
    expect(formatRelativeTime('2026-07-17T11:01:00Z')).toBe('59m ago')
  })

  it('returns hours under a day', () => {
    freeze('2026-07-17T12:00:00Z')
    expect(formatRelativeTime('2026-07-17T09:00:00Z')).toBe('3h ago')
    expect(formatRelativeTime('2026-07-16T12:30:00Z')).toBe('23h ago')
  })

  it('returns days under a week', () => {
    freeze('2026-07-17T12:00:00Z')
    expect(formatRelativeTime('2026-07-15T12:00:00Z')).toBe('2d ago')
    expect(formatRelativeTime('2026-07-11T11:00:00Z')).toBe('6d ago')
  })

  it('falls back to a locale date at 7 days and beyond', () => {
    freeze('2026-07-17T12:00:00Z')
    const expected = new Date('2026-07-07T12:00:00Z').toLocaleDateString()
    expect(formatRelativeTime('2026-07-07T12:00:00Z')).toBe(expected)
  })

  it('treats sqlite timestamps without a Z as UTC, same as ISO strings with Z', () => {
    freeze('2026-07-17T12:00:00Z')
    // datetime('now') style: no T, no zone — must not be parsed as local time
    expect(formatRelativeTime('2026-07-17 11:00:00')).toBe('1h ago')
    expect(formatRelativeTime('2026-07-17T11:00:00Z')).toBe('1h ago')
    expect(formatRelativeTime('2026-07-17 11:00:00')).toBe(
      formatRelativeTime('2026-07-17T11:00:00Z')
    )
  })
})

describe('estimateCost', () => {
  it('uses the per-model rates for known models', () => {
    // gpt-4o: $0.0025/1k in, $0.01/1k out
    expect(estimateCost('gpt-4o', 1000, 1000)).toBeCloseTo(0.0125, 10)
    // haiku: $0.0008/1k in, $0.004/1k out
    expect(estimateCost('claude-3-5-haiku-20241022', 2000, 500)).toBeCloseTo(0.0036, 10)
    // gemini flash: $0.000075/1k in, $0.0003/1k out
    expect(estimateCost('gemini-1.5-flash', 10_000, 10_000)).toBeCloseTo(0.00375, 10)
  })

  it('falls back to $0.003/$0.015 per 1k for unknown models', () => {
    expect(estimateCost('some-unknown-model', 1000, 1000)).toBeCloseTo(0.018, 10)
    expect(estimateCost('some-unknown-model', 2000, 0)).toBeCloseTo(0.006, 10)
  })

  it('returns 0 for the ollama provider, even for unknown models', () => {
    expect(estimateCost('some-unknown-model', 100_000, 100_000, 'ollama')).toBe(0)
    expect(estimateCost('llama3.2', 5000, 5000, 'ollama')).toBe(0)
    // Even a model that exists in the cloud tables is free when run via ollama
    expect(estimateCost('gpt-4o', 1000, 1000, 'ollama')).toBe(0)
  })

  it('charges cloud providers normally when provider is given', () => {
    expect(estimateCost('gpt-4o', 1000, 1000, 'openai')).toBeCloseTo(0.0125, 10)
  })

  it('returns 0 for zero tokens on a non-ollama provider', () => {
    expect(estimateCost('gpt-4o', 0, 0)).toBe(0)
  })
})

describe('formatCost', () => {
  it('shows "< $0.01" below one cent', () => {
    expect(formatCost(0)).toBe('< $0.01')
    expect(formatCost(0.0099)).toBe('< $0.01')
  })

  it('formats one cent and above with two decimals and a tilde', () => {
    expect(formatCost(0.01)).toBe('~$0.01')
    expect(formatCost(1.234)).toBe('~$1.23')
    expect(formatCost(12.5)).toBe('~$12.50')
  })
})
