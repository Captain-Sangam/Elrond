import { createRequire } from 'node:module'
import { runWithNativeRuntime } from './native-runtime.mjs'
const require = createRequire(import.meta.url)
process.exitCode = runWithNativeRuntime(require.resolve('vitest/vitest.mjs'), process.argv.slice(2))
