// Unit tests run in plain Node (no jsdom): main-process pure logic, renderer
// libs/stores (which only touch window.elrond inside actions, stubbed in tests).
// If component tests are ever added, split a jsdom project out of this config.
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true
  }
})
