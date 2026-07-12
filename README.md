# Elrond

**A multi-agent deliberation system for Mac.**

Elrond sends your prompt to multiple AI models simultaneously, has them debate each other, and synthesizes a final answer. Think of it as a council of AI advisors — each brings a different perspective, they critique each other's reasoning, and you get a consolidated result.

All conversations stay on your machine. API keys live in your macOS Keychain. No cloud, no telemetry, no accounts.

## How It Works

```
You → Prompt → [OpenAI, Anthropic, Google]
                       ↓
        ┌─ Debate Round: critique + revise ─┐
        │              ↓                    │
        │   Moderator: converged?  ── no ───┘  (up to N rounds)
        │              ↓ yes
        └──────────────┘
                       ↓
                  Synthesis → Answer
```

1. **Fan-Out** — Your prompt (with any attached images/PDFs) is sent to all three providers in parallel
2. **Initial Responses** — Each agent's answer streams into its own panel
3. **Adaptive Debate** — Each round, agents critique each other **and revise their answers**. A moderator agent then judges whether they've converged: if they still substantively disagree, another round runs (up to a configurable max, default 3); if they agree, the debate ends early
4. **Synthesis** — A designated agent consolidates the final positions and the moderator's findings into a final answer. Synthesis always runs, even with debate disabled

## Screenshots

The app features a dark-themed macOS-native interface with:

- Three side-by-side agent response panels with streaming
- Collapsible debate rounds with per-round moderator verdicts
- Prominent synthesis panel with the consolidated answer
- Session sidebar with search, starring, and history
- Syntax-highlighted code blocks with copy buttons
- Styled markdown tables, blockquotes, and rich formatting

## GitHub Integration

Elrond can query your GitHub repositories directly. Type `/github` in the message input to:

- Browse all your repos (personal and org) in a searchable dropdown
- Select a repo to attach to your message
- Ask about PRs, commits, issues, branches, contributors — all fetched live from the GitHub API
- If the repo is indexed locally, agents also get source code context for code-level questions

### What the agents can access

| Data                                | Example Prompt                         |
| ----------------------------------- | -------------------------------------- |
| Pull Requests (with diffs, reviews) | "Summarize the last 5 PRs"             |
| Commits (with stats, files)         | "What changed in the last 10 commits?" |
| Issues (with comments)              | "List open bugs and their status"      |
| Branches                            | "What branches exist?"                 |
| Contributors                        | "Who are the top contributors?"        |
| Source Code (indexed repos)         | "How does the auth middleware work?"   |

## Install

```bash
git clone https://github.com/Captain-Sangam/elrond.git
cd elrond
npm install
npm run dev
```

That's it. No signing, no certificates, no Homebrew taps.

## Requirements

- **macOS 13 (Ventura)** or later
- **Node.js 18+**
- API keys for at least **two** of: OpenAI, Anthropic, Google

## First Launch

A setup wizard walks you through:

1. **API Keys** — Enter and test keys for each provider (stored in macOS Keychain)
2. **Model Selection** — Dropdowns populated live from each provider's API
3. **Global Shortcut** — Set a keyboard shortcut to summon Elrond from anywhere (default: `Cmd+Shift+Space`)

## Features

### Core Deliberation

- Three-agent fan-out with parallel streaming
- Adaptive multi-round debate — agents critique **and revise** their answers each round
- Moderator agent judges convergence after every round and stops the debate early once agents agree
- Configurable max debate rounds (1–5, default 3) and synthesizer choice
- Debate toggle — skip straight to synthesis for faster, cheaper queries
- Conversation context — follow-up questions carry full history (including attachments)

### Attachments

- Attach **images** (PNG, JPEG, WebP, GIF) and **PDFs** to any message
- Paperclip button, drag-and-drop onto the input, or paste an image from the clipboard
- Sent natively to all three providers as base64 content blocks
- Stored locally and re-sent with follow-up questions, so "what does page 2 say?" just works
- Limits: 10 MB per file, 5 files per message

### GitHub Code Q&A

- `/github` slash command with repo selector dropdown
- Organization support — configure orgs in Settings to see their repos
- Live GitHub API tools — PRs, commits, issues, branches, contributors
- Local repo indexing with SQLite FTS5 for code search
- Auto-detection of `owner/repo` patterns in prompts

### UI & UX

- macOS-native window with hidden titlebar and traffic lights
- Session sidebar with search, starring, rename, delete
- Live stats rail (toggle in the top bar): tokens burnt per phase and per debate round, in/out split, estimated cost, elapsed timer, and consensus outcome — updating in real time as agents stream
- Scroll freely while agents stream — auto-follow only when pinned to the bottom, with a jump-to-bottom button
- Syntax-highlighted code blocks (One Dark theme) with copy buttons
- Styled markdown tables with hover states
- Rich blockquotes, links, and inline code formatting
- Global keyboard shortcut (configurable)
- Menu bar tray icon — always running in background
- Cmd+/- zoom support
- Export sessions as Markdown or JSON

### Settings

- Per-provider model selection (live dropdowns from API)
- Debate toggle and max debate rounds (1–5)
- Custom system prompt for all agents
- Submit key preference (Cmd+Enter or Enter)
- GitHub token and organization configuration
- Danger zone: clear history, reset keys

## Architecture

```
src/
  main/                     Electron main process
    attachments.ts          Image/PDF storage, validation, base64 loading
    db/                     SQLite (sessions, messages, attachments, settings, repos, FTS5)
    github/                 GitHub service (API client, cloning, indexing, tools)
      index.ts              Repo listing, cloning, file walking, code indexing
      tools.ts              Live GitHub tools (PRs, commits, issues, branches)
    ipc/                    IPC handlers bridging renderer ↔ main
    orchestrator/           Deliberation pipeline + provider adapters
      providers/            OpenAI, Anthropic, Google streaming adapters (multimodal)
      prompts.ts            Debate round, moderator + synthesis prompt templates
    keychain.ts             macOS Keychain via keytar
  preload/                  contextBridge typed API
  renderer/                 React UI
    components/
      chat/                 Agent panels, debate rounds, synthesis, markdown renderer
      github/               Repo picker dialog
      layout/               Sidebar, top bar
      onboarding/           Setup wizard
      settings/             Settings dialog
      ui/                   shadcn/ui primitives
    stores/                 Zustand state management
  shared/                   Types shared between main + renderer
```

### Tech Stack

| Layer       | Technology                                             |
| ----------- | ------------------------------------------------------ |
| UI          | Electron + React + TypeScript                          |
| Styling     | Tailwind CSS + shadcn/ui                               |
| State       | Zustand                                                |
| Database    | SQLite via better-sqlite3, FTS5 for search             |
| Key Storage | macOS Keychain via keytar                              |
| AI SDKs     | openai, @anthropic-ai/sdk, @google/generative-ai       |
| Markdown    | react-markdown + remark-gfm + react-syntax-highlighter |
| Build       | electron-vite                                          |

### Data Storage

All data stays local:

- **Database**: `~/Library/Application Support/Elrond/elrond.db` (SQLite)
- **API Keys**: macOS Keychain under `com.elrond.app`
- **Cloned Repos**: `~/Library/Application Support/Elrond/repos/`
- **Attachments**: `~/Library/Application Support/Elrond/attachments/`

## Development

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

## Cost Awareness

Each debate round costs one call per agent plus a short moderator check, so a query that runs the full 3 rounds costs roughly 3-4x a single-round debate. The moderator usually stops well before the cap — simple questions converge in one round. Use the max-rounds setting or the debate toggle to bound cost; with debate off, a query is just the fan-out plus one synthesis call. Token counts are displayed on each panel.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding providers, GitHub tools, and UI components.
