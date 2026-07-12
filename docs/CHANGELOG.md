# Changelog

All notable changes to Elrond will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-07-13

### Added

**MCP Connectivity**

- New MCP tab in Settings: connect [Model Context Protocol](https://modelcontextprotocol.io) servers and manage them in an active-server list with live status badges, expandable tool lists, enable/disable toggles, and reconnect
- Six out-of-the-box presets: Linear, Notion, GitHub, Sentry, Context7, Filesystem. Linear/Notion/Sentry authenticate via browser OAuth through the `mcp-remote` bridge; GitHub/Context7 take an API key (GitHub can reuse the token already saved for the GitHub integration); Filesystem uses a native folder picker
- Custom servers: any stdio command or Streamable HTTP endpoint with env vars / headers; values marked "Secret" are stored in the macOS Keychain (`mcp:<serverId>:<field>`) — the database only holds a sentinel

**Native Tool Calling**

- Agents now call MCP tools mid-response via each provider's native function-calling API — OpenAI and Ollama (`tool_calls`), Anthropic (`tool_use` with streamed `input_json_delta`), and Google Gemini (`functionCall`, with JSON-Schema sanitization for Gemini's stricter parameter format)
- Provider-agnostic tool loop in the orchestrator: stream → execute tool calls → feed results back → re-stream, capped at 8 iterations (the last streams tool-free to force an answer), 16 calls per iteration, and ~16k chars per result; all tool failures are returned to the model as errors instead of sinking the turn
- Tools are active during initial answers and debate rounds (agents can verify each other's claims); the moderator verdict and synthesis run tool-free
- Live tool-call chips in the agent panels while streaming (running spinner → check/error, args and result previews on hover)
- Ollama models without tool support degrade gracefully: one notice, plain answer, no repeated failed requests

### Technical

- New `mcp_servers` table; MCP secrets in Keychain under `mcp:<serverId>:<field>`
- `AgentProvider.streamChat` now takes an options object (`{ signal, tools }`) and yields a `StreamChunk` union (`text` | `tool_call`); `ChatMessage` gains `tool` role and assistant `toolCalls`
- Google provider refactored from `startChat` to `generateContentStream` — this also fixes its previously ignored `AbortSignal`
- Anthropic `max_tokens` raised 4096 → 8192
- New `stream:tool` and `mcp:statusChanged` renderer events; per-iteration `stream:start` re-emits keep the stats rail's input-token estimates cumulative across tool loops
- Stdio servers spawn with the user's login-shell PATH so `npx`-based servers work in packaged builds launched from Finder

## [0.3.0] - 2026-07-12

### Added

**Web Search**

- Globe toggle in the message input arms a one-shot web search for that message (Tavily search API — free tier, no card — key stored in Keychain, configured in Settings → Web Search)
- Top results are injected into the agents' context with cite-your-sources instructions; failures surface as a non-fatal notice and the deliberation continues

**GitHub UX**

- Tabbed Settings dialog (General / Providers / GitHub / Web Search)
- Repo management in the GitHub tab: searchable repo list with Index / Reindex / Remove, file counts and indexed-ago timestamps
- Slash-command autocomplete: typing `/` shows a popup describing `/github` with Tab/Enter completion
- Indexed-status badges in the chat repo selector; selecting an unindexed repo shows an amber chip with an inline "Index now" action and live progress — sending is never blocked
- Indexing reports progress stages (cloning → scanning → storing) everywhere it can be triggered

### Changed

- Documentation restructured: README is user setup only, `CLAUDE.md` is an index, and all other docs (features, architecture, development, changelog, community files) live under `docs/`

### Fixed

- Indexing no longer freezes the app: `git clone`/`git pull` run asynchronously (previously `execSync` blocked the main process for up to two minutes)
- Reindexing a repo no longer breaks existing sessions bound to it (the index row's id is now preserved)
- Freshly indexed repos no longer show "Invalid Date" timestamps in renderer state

## [0.2.0] - 2026-07-12

### Added

**Adaptive Multi-Round Debate**

- Debate now runs multiple rounds: each round, agents critique the others **and revise their own answers**
- A moderator agent (the configured synthesizer) reviews every round and ends the debate early once agents converge
- Configurable max debate rounds (1–5, default 3) in Settings
- Per-round moderator verdicts shown in the UI and stored with the session
- Debate rounds render as collapsible sections, both live and in history

**Image + PDF Attachments**

- Attach images (PNG, JPEG, WebP, GIF) and PDFs via paperclip button, drag-and-drop, or clipboard paste
- Files are sent to all three providers as native base64 content blocks
- Attachments are stored locally (`~/Library/Application Support/Elrond/attachments/`) and re-sent with follow-up questions so the conversation keeps its context
- Limits: 10 MB per file, 5 files per message

**Live Stats Panel**

- Collapsible right-side stats rail (toggle in the top bar) with real-time token accounting: burn counter for the current turn, input/output split per phase and per debate round (moderator included), estimated cost, elapsed timer, consensus outcome, and session totals
- All figures are estimates (chars ÷ 4) — a new `stream:start` event carries the prompt size per provider call

**Developer Experience**

- Makefile with `install`, `dev`, `build`, `start`, `test`, `export`, and `clean` targets
- `make export` packages an unsigned `Elrond.app` (electron-builder) and installs it to `/Applications`, so the app can be launched from Spotlight
- App icon (`build/icon.icns`) matching the in-app welcome mark — the Sparkles symbol on the app's dark theme; dev runs set the same Dock icon

### Fixed

- Scrolling no longer fights the user while agents are streaming — the view only auto-follows when pinned to the bottom, with a jump-to-bottom button when scrolled up
- Clicking "New Session" repeatedly no longer piles up empty sessions; the session row is created when the first message is sent, and existing orphaned empty sessions are cleaned up on startup
- Synthesis now always runs, so a final answer is produced even with debate disabled or a single provider (previously those turns produced no synthesis and were invisible to follow-up context)
- Cancelling a deliberation no longer leaves the UI stuck in the "deliberating" state
- Google defaults no longer point at retired models: the seeded default is now the rolling `gemini-pro-latest` alias (installs stuck on the dead `gemini-1.5-pro` default are migrated), and a retired-model 404 now says which model is gone and points to Settings

### Technical

- `messages` table migration: new `round` column and `moderator` role (existing debate rows are backfilled as round 1; FTS index preserved)
- New `attachments` table and `elrond-attachment://` protocol for serving stored files to the renderer
- Provider adapters accept multimodal content parts (`text`, `image`, `file`)
- New stream events: `stream:moderator` verdicts and a `complete` phase that reliably ends every deliberation

## [0.1.0] - 2026-03-08

### Added

**Core Deliberation**

- Multi-agent fan-out: prompts sent to OpenAI, Anthropic, and Google simultaneously
- Structured debate round where each agent critiques the other two
- Configurable synthesis by any of the three providers
- Streaming responses with per-agent panels
- Conversation context maintained across follow-up questions
- Debate toggle to skip the critique phase for faster/cheaper queries

**GitHub Integration**

- `/github` slash command with searchable repo dropdown
- Organization support — configure orgs in Settings for repo listing
- Live GitHub API tools: pull requests (with diffs and reviews), commits, issues, branches, contributors
- Local repo cloning and indexing with SQLite FTS5 for code search
- Auto-detection of `owner/repo` patterns in prompts
- Repo session type with dedicated git branch icon in sidebar

**UI**

- macOS-native Electron window with hidden titlebar
- Session sidebar with full-text search, starring, rename, delete
- Three-step setup wizard (API keys, model selection, global shortcut)
- Settings dialog with live model dropdowns from provider APIs
- Syntax-highlighted code blocks (One Dark theme) with copy buttons
- Styled markdown tables, blockquotes, links
- Global keyboard shortcut (default: Cmd+Shift+Space)
- Menu bar tray icon
- Export sessions as Markdown or JSON
- Standard macOS keyboard shortcuts (zoom, copy, paste, undo)

**Data**

- Local SQLite database for sessions, messages, settings, and indexed repos
- macOS Keychain for API key storage
- Full-text search across all message content (FTS5)
- Session auto-titling from first prompt

### Technical

- Electron 33 + React 19 + TypeScript
- Vite-based build via electron-vite
- Tailwind CSS + shadcn/ui components
- Zustand for state management
- Provider abstraction (`AgentProvider` interface) for easy provider additions
- Tool detection system for GitHub API queries
