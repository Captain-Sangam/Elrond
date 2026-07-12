# Development

## Commands

```bash
npm run dev      # Start in development mode with HMR
npm run build    # Build for production
```

Or via the Makefile:

```bash
make install     # npm install
make dev         # development mode with HMR
make build       # production build into out/
make start       # build + launch the production bundle
make test        # typecheck + build (no unit-test suite yet)
make export      # package Elrond.app into /Applications (Spotlight-searchable)
make clean       # remove build output
```

## Packaging

`make export` builds an unsigned `Elrond.app` with electron-builder (config in
`electron-builder.yml`, icon in `build/icon.icns`) and installs it into
`/Applications` (falls back to `~/Applications`). No signing certificates are
needed — electron-builder ad-hoc signs on Apple Silicon so the app launches.

Re-run `make export` to replace the installed copy after changes. Quit the
running instance from the tray first, or the old build keeps running.

## Notes for contributors

- The renderer typecheck (`npx tsc --noEmit -p tsconfig.web.json`) is clean and
  should stay that way; `tsconfig.node.json` has two known pre-existing errors
  (a `GitHubHeaders` fetch overload and a regex-flag target complaint) that the
  esbuild-based electron-vite build ignores.
- Token counts across the app are estimates (chars ÷ 4) — the app does not read
  real usage from provider SDKs.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding providers,
  GitHub tools, and UI components, and [architecture.md](architecture.md) for
  the module layout.
