# Changelog

All notable changes to Elrond will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
