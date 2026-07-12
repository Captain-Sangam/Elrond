# Changelog

All notable changes to Elrond will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
