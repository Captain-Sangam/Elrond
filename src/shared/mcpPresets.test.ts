import { describe, expect, it } from 'vitest'
import { MCP_PRESETS } from './mcpPresets'
import { MCP_SECRET_SENTINEL } from './types'

// Env vars (stdio) or headers (http) — the record whose values may hold the
// Keychain sentinel
function secretSlots(preset: (typeof MCP_PRESETS)[number]): Record<string, string> {
  return preset.transport.type === 'stdio' ? preset.transport.env : preset.transport.headers
}

describe('MCP_PRESETS consistency', () => {
  it('has at least one preset', () => {
    expect(MCP_PRESETS.length).toBeGreaterThan(0)
  })

  it('has a unique id for every preset', () => {
    const ids = MCP_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares a secretFields entry for every sentinel slot in the transport', () => {
    for (const preset of MCP_PRESETS) {
      const slots = secretSlots(preset)
      const sentinelKeys = Object.keys(slots).filter((k) => slots[k] === MCP_SECRET_SENTINEL)
      const declared = preset.secretFields.map((f) => f.field)

      for (const key of sentinelKeys) {
        expect(declared, `preset "${preset.id}" has sentinel "${key}" without a secretFields entry`).toContain(key)
      }
    }
  })

  it('holds the sentinel in the transport slot for every declared secret field', () => {
    for (const preset of MCP_PRESETS) {
      const slots = secretSlots(preset)
      for (const { field } of preset.secretFields) {
        expect(
          slots[field],
          `preset "${preset.id}" declares secret field "${field}" but its transport slot is not the sentinel`
        ).toBe(MCP_SECRET_SENTINEL)
      }
    }
  })

  it('gives every stdio preset a non-empty command', () => {
    for (const preset of MCP_PRESETS) {
      if (preset.transport.type !== 'stdio') continue
      expect(preset.transport.command.trim().length, `preset "${preset.id}"`).toBeGreaterThan(0)
    }
  })

  it('never leaks the sentinel into stdio args', () => {
    for (const preset of MCP_PRESETS) {
      if (preset.transport.type !== 'stdio') continue
      expect(preset.transport.args, `preset "${preset.id}"`).not.toContain(MCP_SECRET_SENTINEL)
    }
  })
})
