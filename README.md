# Elrond

**A multi-agent deliberation system for Mac.**

Elrond orchestrates structured debates between multiple AI models. Submit a single prompt and get responses from OpenAI, Anthropic, and Google simultaneously — then watch them critique each other before a final synthesis.

All conversations stay on your machine. API keys live in your macOS Keychain. No cloud, no telemetry, no accounts.

## How It Works

```
You → Prompt → [OpenAI, Anthropic, Google] → Debate Round → Synthesis → Answer
```

1. **Fan-Out** — Your prompt is sent to all three providers in parallel
2. **Initial Responses** — Each agent's answer streams into its own panel
3. **Debate** — Each agent critiques the other two (optional, can be disabled)
4. **Synthesis** — A designated agent produces a consolidated final answer

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

On first run, a setup wizard walks you through:

1. **API Keys** — Enter and test keys for each provider (stored in macOS Keychain)
2. **Model Selection** — Pick your preferred model per provider
3. **Global Shortcut** — Set a keyboard shortcut to summon Elrond from anywhere (default: `⌘+Shift+Space`)

## Features

- **Three-agent deliberation** with structured debate and synthesis
- **Streaming responses** — see each agent think in real time
- **Session history** with full-text search
- **Export** sessions as Markdown or JSON
- **Star and organize** sessions
- **Custom system prompts** prepended to all agent calls
- **Debate toggle** — skip the debate round for faster, cheaper queries
- **Global shortcut** — invoke Elrond from any app
- **Menu bar tray** — always running in the background
- **Token cost estimates** per query
- **Copy buttons** on every panel

## Architecture

```
src/
  main/              Electron main process
    db/              SQLite (sessions, messages, settings, FTS5)
    ipc/             IPC handlers bridging renderer ↔ main
    orchestrator/    Deliberation pipeline + provider adapters
    keychain.ts      macOS Keychain via keytar
  preload/           contextBridge API
  renderer/          React UI
    components/      shadcn/ui based components
    stores/          Zustand state management
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
| Build | electron-vite + electron-builder |

## Development

```bash
npm run dev      # Start in development mode with HMR
npm run build    # Build for production
npm run pack     # Package as .app (unsigned)
npm run dist     # Create distributable .dmg
```

## Configuration

All settings are accessible from the sidebar gear icon:

- **Models** — Change the model for each provider
- **Synthesizer** — Pick which provider runs the final synthesis
- **Debate Round** — Enable/disable the critique phase
- **Submit Key** — `⌘+Enter` or `Enter` to send
- **System Prompt** — Custom instructions for all agents
- **Danger Zone** — Clear history, reset API keys

## Cost Awareness

Running three frontier models per query costs roughly 3–5× a single model call. The UI displays estimated token costs after each deliberation. Use the "disable debate" toggle to halve cost on simple queries.

## License

MIT
