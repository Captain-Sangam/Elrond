# Architecture

## How It Works

```
You → Prompt → [Agent 1, Agent 2, … Agent N]
                       ↓
        ┌─ Debate Round: critique + revise ─┐
        │              ↓                    │
        │   Moderator: converged?  ── no ───┘  (up to N rounds)
        │              ↓ yes
        └──────────────┘
                       ↓
                  Synthesis → Answer
```

Each agent is a named slot assigned a provider + model in the Agents dialog. Providers are OpenAI, Anthropic, Google (cloud, keyed) and Ollama (local, keyless). Several agents can share a provider — e.g. two different Ollama models debating each other.

1. **Fan-Out** — Your prompt (with any attached images/PDFs, repo context, and web search results) is sent to all enabled agents in parallel
2. **Initial Responses** — Each agent's answer streams into its own panel
3. **Adaptive Debate** — Each round, agents critique each other **and revise their answers**. A moderator agent then judges whether they've converged: if they still substantively disagree, another round runs (up to a configurable max, default 3); if they agree, the debate ends early
4. **Synthesis** — A designated agent consolidates the final positions and the moderator's findings into a final answer. Synthesis always runs, even with debate disabled

## Module Layout

```
src/
  main/                     Electron main process
    attachments.ts          Image/PDF storage, validation, base64 loading
    websearch.ts            Tavily web-search client + result formatting
    db/                     SQLite (sessions, messages, attachments, settings, repos, MCP servers, FTS5)
    github/                 GitHub service (API client, cloning, indexing, tools)
      index.ts              Repo listing, cloning, file walking, code indexing
      tools.ts              Live GitHub tools (PRs, commits, issues, branches)
    mcp/                    MCP server connectivity
      manager.ts            Connection lifecycle, tool cache, listAllTools/callTool API
      store.ts              Server config persistence, Keychain secret resolution
      shellEnv.ts           Login-shell PATH resolution (npx in packaged builds)
    ipc/                    IPC handlers bridging renderer ↔ main
    orchestrator/           Deliberation pipeline + provider adapters
      providers/            OpenAI, Anthropic, Google, Ollama streaming adapters (multimodal, tool-calling)
      prompts.ts            Debate round, moderator + synthesis prompt templates
      toolLoop.ts           Provider-agnostic agentic loop (stream → call MCP tools → re-stream)
    agentStore.ts           Agent configs (persistence, validation, first-run seeding)
    keychain.ts             macOS Keychain via keytar
  preload/                  contextBridge typed API
  renderer/                 React UI
    components/
      agents/               Agents dialog (assignments, provider status)
      chat/                 Agent panels, debate rounds, synthesis, tool-call chips, markdown renderer
      github/               Repo picker dialog
      layout/               Sidebar, top bar, stats panel
      onboarding/           Setup wizard
      settings/             Settings dialog (tabbed), repo manager, MCP server manager
      ui/                   shadcn-style primitives (incl. local tabs)
    stores/                 Zustand state (sessions, settings, agents, indexing progress, MCP servers)
  shared/                   Types shared between main + renderer (incl. MCP presets)
```

## Tech Stack

| Layer       | Technology                                             |
| ----------- | ------------------------------------------------------ |
| UI          | Electron + React + TypeScript                          |
| Styling     | Tailwind CSS + shadcn/ui                               |
| State       | Zustand                                                |
| Database    | SQLite via better-sqlite3, FTS5 for search             |
| Key Storage | macOS Keychain via keytar                              |
| AI SDKs     | openai (also drives Ollama via its OpenAI-compatible /v1), @anthropic-ai/sdk, @google/generative-ai |
| MCP         | @modelcontextprotocol/sdk (stdio + Streamable HTTP transports) |
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

Agents get context two ways: pre-fetched context injected into the system prompt before they run, and live MCP tools they call themselves mid-response.

### Injected context (pre-fetched)

- **GitHub tools** (keyword-triggered when a repo is in scope): pull requests (with diffs/reviews), commits, issues, branches, contributors, repo overview
- **Indexed code search**: FTS5 over locally cloned repo files (index repos in Settings → GitHub or inline from the chat repo selector)
- **Web search** (globe toggle): top Tavily results (LLM-ready page content) with cite-your-sources instructions

A repo enters scope via the `/github` selector, the session's attached repo, or auto-detection of `owner/repo` patterns in the prompt.

### MCP tools (native function calling)

Servers connected in Settings → MCP expose their tools to every agent through each provider's native function-calling API (OpenAI/Ollama `tool_calls`, Anthropic `tool_use`, Gemini `functionCall`).

- **Connection lifecycle** (`src/main/mcp/manager.ts`): enabled servers connect eagerly at app start and on toggle, cache their tool lists, push status changes to the renderer, and reconnect with capped backoff. Stdio servers spawn as child processes with the user's login-shell PATH (so `npx` works in packaged builds); HTTP servers use the Streamable HTTP transport with configurable headers.
- **The loop** (`src/main/orchestrator/toolLoop.ts`): each agent streams, the loop executes any tool calls against the MCP manager, appends the results as tool messages, and re-streams — up to 8 iterations, with the final iteration forced tool-free so the model must answer. Tool names are namespaced per server (`linear__list_issues`); results are truncated to ~16k chars; every failure is fed back to the model as a tool-error message rather than aborting the turn.
- **Phase scope**: tools are active during the initial fan-out and debate rounds. The moderator (strict-JSON verdict) and synthesis (merges already-debated positions) run tool-free.
- **Secrets**: header/env credentials are stored in the Keychain (`mcp:<serverId>:<field>`); SQLite only ever holds a `__KEYCHAIN__` sentinel. OAuth-based hosted servers (Linear, Notion, Sentry) connect through the `mcp-remote` stdio bridge, which handles the browser flow and token cache itself.
