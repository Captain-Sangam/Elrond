import { execFile } from 'child_process'

// A packaged app launched from Finder inherits the bare launchd PATH
// (/usr/bin:/bin:...), which is missing Homebrew/nvm/Volta — so spawning
// `npx` fails. Resolve the user's real login-shell PATH once per run.
const PATH_MARKER = '__ELROND_PATH__'
const FALLBACK_EXTRAS = ':/usr/local/bin:/opt/homebrew/bin'

let cachedPath: Promise<string> | null = null

function resolveLoginShellPath(): Promise<string> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    execFile(
      shell,
      ['-ilc', `echo -n "${PATH_MARKER}$PATH"`],
      { timeout: 5000 },
      (err, stdout) => {
        const idx = err ? -1 : stdout.lastIndexOf(PATH_MARKER)
        if (idx === -1) {
          resolve((process.env.PATH || '') + FALLBACK_EXTRAS)
        } else {
          resolve(stdout.slice(idx + PATH_MARKER.length))
        }
      }
    )
  })
}

export function getShellPath(): Promise<string> {
  if (!cachedPath) {
    cachedPath = resolveLoginShellPath()
  }
  return cachedPath
}
