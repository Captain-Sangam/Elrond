import { build } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runWithNativeRuntime } from '../native-runtime.mjs'

const directory = await mkdtemp(join(tmpdir(), 'elrond-bench-'))
try {
  await build({
    configFile: false, logLevel: 'error',
    build: {
      target: 'node20', outDir: directory, emptyOutDir: false, minify: false,
      lib: { entry: resolve('scripts/bench/cli.ts'), formats: ['cjs'], fileName: () => 'bench.cjs' },
      rollupOptions: { external: (id) => !id.startsWith('.') && !id.startsWith('/') }
    }
  })
  // Temp output cannot resolve dependencies from the repo without NODE_PATH.
  // Resolve native/SDK dependencies explicitly; no global installs are consulted.
  const previous = process.env.NODE_PATH
  process.env.NODE_PATH = resolve('node_modules')
  try { process.exitCode = runWithNativeRuntime(join(directory, 'bench.cjs'), process.argv.slice(2)) }
  finally { if (previous === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = previous }
} finally { await rm(directory, { recursive: true, force: true }) }
