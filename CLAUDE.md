# Elrond

Multi-agent AI deliberation app for macOS — Electron + React + TypeScript, SQLite, Zustand, macOS Keychain. This file is an index only; the details live in `docs/`.

## Documentation

- [README.md](README.md) — user setup: requirements, install, first launch, API keys
- [docs/architecture.md](docs/architecture.md) — deliberation pipeline, module layout, tech stack, data storage, context tools
- [docs/features.md](docs/features.md) — feature reference: debate, attachments, GitHub Q&A, web search, stats, settings, cost
- [docs/development.md](docs/development.md) — commands (`make dev/test/export`), packaging, contributor notes
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — how to add providers, GitHub tools, UI components
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — release history
- [docs/SECURITY.md](docs/SECURITY.md) · [docs/CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md)

## Key entry points

- `src/main/orchestrator/index.ts` — the deliberation pipeline (fan-out → debate rounds → moderator → synthesis)
- `src/shared/types.ts` — all IPC/type contracts between main and renderer
- `src/renderer/src/stores/sessionStore.ts` — renderer state for sessions and live streams
