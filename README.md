# Elrond

**A multi-agent deliberation system for Mac.**

Elrond sends your prompt to multiple AI models simultaneously, has them debate each other, and synthesizes a final answer. Think of it as a council of AI advisors — each brings a different perspective, they critique each other's reasoning, and you get a consolidated result.

All conversations stay on your machine. API keys live in your macOS Keychain. No cloud, no telemetry, no accounts.

## How It Works

```
You → Prompt → [OpenAI, Anthropic, Google] → Debate Round → Synthesis → Answer
```

1. **Fan-Out** — Your prompt is sent to all three providers in parallel
2. **Initial Responses** — Each agent's answer streams into its own panel
3. **Debate** — Each agent critiques the other two (optional, can be disabled)
4. **Synthesis** — A designated agent consolidates everything into a final answer

## Screenshots

The app features a dark-themed macOS-native interface with:
- Three side-by-side agent response panels with streaming
- Collapsible debate round showing each agent's critique
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

| Data | Example Prompt |
|------|---------------|
| Pull Requests (with diffs, reviews) | "Summarize the last 5 PRs" |
| Commits (with stats, files) | "What changed in the last 10 commits?" |
| Issues (with comments) | "List open bugs and their status" |
| Branches | "What branches exist?" |
| Contributors | "Who are the top contributors?" |
| Source Code (indexed repos) | "How does the auth middleware work?" |

## Install

### From Source

```bash
git clone https://github.com/YOUR_USERNAME/elrond.git
cd elrond
npm install
npm run dev
```

### Via Homebrew (coming soon)

```bash
brew tap YOUR_USERNAME/elrond
brew install elrond
```

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
- Structured debate round with critique prompts
- Configurable synthesis (pick which agent synthesizes)
- Debate toggle — skip for faster, cheaper queries
- Conversation context — follow-up questions carry full history

### GitHub Code Q&A
- `/github` slash command with repo selector dropdown
- Organization support — configure orgs in Settings to see their repos
- Live GitHub API tools — PRs, commits, issues, branches, contributors
- Local repo indexing with SQLite FTS5 for code search
- Auto-detection of `owner/repo` patterns in prompts

### UI & UX
- macOS-native window with hidden titlebar and traffic lights
- Session sidebar with search, starring, rename, delete
- Syntax-highlighted code blocks (One Dark theme) with copy buttons
- Styled markdown tables with hover states
- Rich blockquotes, links, and inline code formatting
- Global keyboard shortcut (configurable)
- Menu bar tray icon — always running in background
- Cmd+/- zoom support
- Export sessions as Markdown or JSON

### Settings
- Per-provider model selection (live dropdowns from API)
- Custom system prompt for all agents
- Submit key preference (Cmd+Enter or Enter)
- GitHub token and organization configuration
- Danger zone: clear history, reset keys

## Architecture

```
src/
  main/                     Electron main process
    db/                     SQLite (sessions, messages, settings, repos, FTS5)
    github/                 GitHub service (API client, cloning, indexing, tools)
      index.ts              Repo listing, cloning, file walking, code indexing
      tools.ts              Live GitHub tools (PRs, commits, issues, branches)
    ipc/                    IPC handlers bridging renderer ↔ main
    orchestrator/           Deliberation pipeline + provider adapters
      providers/            OpenAI, Anthropic, Google streaming adapters
      prompts.ts            Debate + synthesis prompt templates
    keychain.ts             macOS Keychain via keytar
  preload/                  contextBridge typed API
  renderer/                 React UI
    components/
      chat/                 Agent panels, debate, synthesis, markdown renderer
      github/               Repo picker dialog
      layout/               Sidebar, top bar
      onboarding/           Setup wizard
      settings/             Settings dialog
      ui/                   shadcn/ui primitives
    stores/                 Zustand state management
  shared/                   Types shared between main + renderer
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | Electron + React + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Database | SQLite via better-sqlite3, FTS5 for search |
| Key Storage | macOS Keychain via keytar |
| AI SDKs | openai, @anthropic-ai/sdk, @google/generative-ai |
| Markdown | react-markdown + remark-gfm + react-syntax-highlighter |
| Build | electron-vite + electron-builder |

### Data Storage

All data stays local:
- **Database**: `~/Library/Application Support/Elrond/elrond.db` (SQLite)
- **API Keys**: macOS Keychain under `com.elrond.app`
- **Cloned Repos**: `~/Library/Application Support/Elrond/repos/`

## Development

```bash
npm run dev      # Start in development mode with HMR
npm run build    # Build for production
npm run pack     # Package as .app (unsigned)
npm run dist     # Create distributable .dmg
```

## Cost Awareness

Running three frontier models per query costs roughly 3-5x a single model call. Use the "disable debate" toggle to halve cost on simple queries. Token counts are displayed on each panel.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding providers, GitHub tools, and UI components.
