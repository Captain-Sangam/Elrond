# Development

## Commands

```bash
npm run dev         # Start in development mode with HMR
npm run build       # Build for production
npm test            # Run the unit-test suite once (vitest)
npm run test:watch  # Run vitest in watch mode
npm run typecheck   # Typecheck both the main and renderer projects
```

Or via the Makefile:

```bash
make install     # npm install
make dev         # development mode with HMR
make build       # production build into out/
make start       # build + launch the production bundle
make test        # typecheck + unit tests + build — the full local gate
make export      # package Elrond.app into /Applications (Spotlight-searchable)
make clean       # remove build output
```

## Testing

Unit tests run with [vitest](https://vitest.dev) in a plain Node environment
and live next to the modules they cover (`src/**/*.test.ts`). They focus on
the pure logic that regresses silently: prompt building and verdict parsing,
tool namespacing, provider message conversion, cost/token estimation, database
migrations (against in-memory SQLite), and store state transitions. Native
modules with side effects (keytar) are always mocked — tests must never touch
the real keychain or the network.

CI (`.github/workflows/ci.yaml`) runs typecheck + tests on Ubuntu and a
production build on macOS for every PR.

If the database tests fail locally with `ERR_DLOPEN_FAILED` /
`NODE_MODULE_VERSION` errors, your better-sqlite3 binding was built for
Electron's ABI (the `postinstall` does this). Fix with:

```bash
npm rebuild better-sqlite3   # rebuild for plain Node → tests work
npm install                  # restore the Electron build → app works again
```

## Packaging

`make export` builds an unsigned `Elrond.app` with electron-builder (config in
`electron-builder.yml`, icon in `build/icon.icns`) and installs it into
`/Applications` (falls back to `~/Applications`). No signing certificates are
needed — electron-builder ad-hoc signs on Apple Silicon so the app launches.

Re-run `make export` to replace the installed copy after changes. Quit the
running instance from the tray first, or the old build keeps running.

## Notes for contributors

- Both typecheck projects (`npm run typecheck` covers `tsconfig.node.json` and
  `tsconfig.web.json`) are clean and CI enforces that they stay that way.
- Token counts across the app are estimates (chars ÷ 4) — the app does not read
  real usage from provider SDKs.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding providers,
  GitHub tools, and UI components, and [architecture.md](architecture.md) for
  the module layout.
