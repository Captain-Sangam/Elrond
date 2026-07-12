# Architecture

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

1. **Fan-Out** — Your prompt (with any attached images/PDFs, repo context, and web search results) is sent to all three providers in parallel
2. **Initial Responses** — Each agent's answer streams into its own panel
3. **Adaptive Debate** — Each round, agents critique each other **and revise their answers**. A moderator agent then judges whether they've converged: if they still substantively disagree, another round runs (up to a configurable max, default 3); if they agree, the debate ends early
4. **Synthesis** — A designated agent consolidates the final positions and the moderator's findings into a final answer. Synthesis always runs, even with debate disabled

## Module Layout

```
src/
  main/                     Electron main process
    attachments.ts          Image/PDF storage, validation, base64 loading
    websearch.ts            Tavily web-search client + result formatting
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
      layout/               Sidebar, top bar, stats panel
      onboarding/           Setup wizard
      settings/             Settings dialog (tabbed), repo manager
      ui/                   shadcn-style primitives (incl. local tabs)
    stores/                 Zustand state (sessions, settings, indexing progress)
  shared/                   Types shared between main + renderer
```

## Tech Stack

| Layer       | Technology                                             |
| ----------- | ------------------------------------------------------ |
| UI          | Electron + React + TypeScript                          |
| Styling     | Tailwind CSS + shadcn/ui                               |
| State       | Zustand                                                |
| Database    | SQLite via better-sqlite3, FTS5 for search             |
| Key Storage | macOS Keychain via keytar                              |
| AI SDKs     | openai, @anthropic-ai/sdk, @google/generative-ai       |
| Web Search  | Tavily API                                             |
| Markdown    | react-markdown + remark-gfm + react-syntax-highlighter |
| Build       | electron-vite + electron-builder                       |

## Data Storage

All data stays local:

- **Database**: `~/Library/Application Support/Elrond/elrond.db` (SQLite)
- **API Keys**: macOS Keychain under `com.elrond.app`
- **Cloned Repos**: `~/Library/Application Support/Elrond/repos/`
- **Attachments**: `~/Library/Application Support/Elrond/attachments/`

## Context Tools

Agents have no function-calling loop — the orchestrator pre-fetches context before the agents run and injects it into the system prompt:

- **GitHub tools** (keyword-triggered when a repo is in scope): pull requests (with diffs/reviews), commits, issues, branches, contributors, repo overview
- **Indexed code search**: FTS5 over locally cloned repo files (index repos in Settings → GitHub or inline from the chat repo selector)
- **Web search** (globe toggle): top Tavily results (LLM-ready page content) with cite-your-sources instructions

A repo enters scope via the `/github` selector, the session's attached repo, or auto-detection of `owner/repo` patterns in the prompt.
