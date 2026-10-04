# Development

## Commands

```bash
npm run dev         # Start in development mode with HMR
npm run build       # Build for production
npm test            # Run the unit-test suite once (vitest)
npm run test:watch  # Run vitest in watch mode
npm run typecheck   # Typecheck both the main and renderer projects
npm run bench       # Isolated, offline orchestration benchmark smoke test
```

Or via the Makefile:

```bash
make install     # npm install
make dev         # development mode with HMR
make build       # production build into out/
make start       # build + launch the production bundle
make test        # typecheck + unit tests + build — the full local gate
make bench       # benchmark harness; see docs/benchmarks.md for live runs/labeling
make export      # package Elrond.app into /Applications (Spotlight-searchable)
make clean       # remove build output
```

## Testing

Unit tests run with [vitest](https://vitest.dev) in a plain Node environment
and live next to the modules they cover (`src/**/*.test.ts`, plus
`scripts/bench/**/*.test.ts`). They focus on
the pure logic that regresses silently: prompt building and verdict parsing,
tool namespacing, provider message conversion, cost/token estimation, database
migrations (against in-memory SQLite), and store state transitions. Native
modules with side effects (keytar) are always mocked — tests must never touch
the real keychain or the network.

CI (`.github/workflows/ci.yaml`) runs typecheck + tests on Ubuntu and a
production build on macOS for every PR.

The test and benchmark launchers first try the current Node runtime. If the
installed SQLite binding was built for Electron (as `postinstall` normally does),
they use Electron's embedded Node mode instead. No window is opened and the
native binding is left usable by the app. Direct `vitest` invocations may still
need a runtime matching the binding. Manual rebuild commands are:

```bash
npm rebuild better-sqlite3                  # rebuild for plain Node → tests work
npx electron-rebuild -f -w better-sqlite3   # restore the Electron build → app works again
```

The `-f` on the restore matters: a plain `npm install` (or `install-app-deps`)
can silently skip the rebuild because electron-rebuild's cache still thinks the
module is already built for Electron.

The reverse direction is nastier: packaging while the binding is still built for
plain Node produces an app that **launches with no window**. `initDatabase()`
throws, and because the `app.whenReady()` chain in `src/main/index.ts` has no
`.catch()`, the rejection is swallowed and `createWindow()` never runs — you get
live Electron processes and no UI. `make export` now forces the Electron rebuild
before packaging so this can't happen; to see the real error in a packaged app,
run it with `ELECTRON_ENABLE_LOGGING=1`.

## Packaging

See [packaging and installation](deployment.md) for `make export`, installation paths, native rebuilds, and startup troubleshooting.

## Notes for contributors

- Both typecheck projects (`npm run typecheck` covers `tsconfig.node.json` and
  `tsconfig.web.json`) are clean and CI enforces that they stay that way.
- Token counts across the app are estimates (chars ÷ 4) — the app does not read
  real usage from provider SDKs.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding providers,
  GitHub tools, and UI components, and [architecture.md](architecture.md) for
  the module layout.
