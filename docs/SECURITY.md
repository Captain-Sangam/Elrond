# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in Elrond, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly (see the GitHub profile for contact info)
3. Include a description of the vulnerability, steps to reproduce, and potential impact
4. Allow reasonable time for a fix before public disclosure

## Security Design

Elrond is designed with security in mind:

- **API keys** are stored exclusively in the macOS Keychain via `keytar`, never in SQLite or plaintext files
- **No telemetry** — no data leaves your machine except the API calls you explicitly make
- **No cloud sync** — all data is local to `~/Library/Application Support/Elrond/`
- **Context isolation** — the renderer process cannot access Node.js APIs directly; all access goes through a typed `contextBridge` API
- **No `nodeIntegration`** — disabled in the renderer for defense in depth
- **GitHub tokens** are stored in the same Keychain and only used for API calls to `api.github.com`

## Dependencies

We pin SDK versions in `package.json` and recommend running `npm audit` periodically. Native dependencies (`better-sqlite3`, `keytar`) are rebuilt for the specific Electron version via `electron-builder install-app-deps`.
