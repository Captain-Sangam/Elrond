import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)

export function runWithNativeRuntime(entry, args = []) {
  let runtime = process.execPath
  let env = process.env
  try {
    const Database = require('better-sqlite3')
    new Database(':memory:').close()
  } catch (error) {
    if (error.code !== 'ERR_DLOPEN_FAILED') throw error
    runtime = require('electron')
    env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
  const result = spawnSync(runtime, [entry, ...args], { stdio: 'inherit', env })
  if (result.error) throw result.error
  return result.status ?? 1
}
