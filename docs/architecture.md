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
3. **Adaptive Debate** — Agents critique and revise their answers around stable unresolved issue IDs. A moderator refreshes the issue inventory after each productive round. `UNCHANGED` preserves the prior position verbatim; when every position stays unchanged while known issues remain, the debate stops as stagnated. Agreement, stagnation, the round cap and incomplete reviews have distinct outcomes; failed moderation never counts as agreement.
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
      index.ts              Electron/Keychain/context services wired into the runner
      runner.ts             Injectable pipeline (database, event sink, providers, context)
      providers/            OpenAI, Anthropic, Google, Ollama streaming adapters (multimodal, tool-calling)
      prompts.ts            Debate round, moderator + synthesis prompt templates
      toolLoop.ts           Provider-agnostic agentic loop (stream → call MCP tools → re-stream)
      utils.ts              Pure helpers: token estimates, error-message cleanup, attachment parts
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
      ui/                   Thin wrappers over Astryx components, keeping the app's own prop API
    stores/                 Zustand state (sessions, settings, agents, indexing progress, MCP servers)
  shared/                   Types shared between main + renderer (incl. MCP presets)
```

Unit tests are co-located with the modules they cover (`src/**/*.test.ts`) and
run with vitest — see [development.md](development.md#testing).

## Tech Stack

| Layer       | Technology                                             |
| ----------- | ------------------------------------------------------ |
| UI          | Electron + React + TypeScript                          |
| Styling     | Astryx design system (Gothic theme) + Tailwind for layout |
| State       | Zustand                                                |
| Database    | SQLite via better-sqlite3, FTS5 for search             |
| Key Storage | macOS Keychain via keytar                              |
| AI SDKs     | openai (also drives Ollama via its OpenAI-compatible /v1), @anthropic-ai/sdk, @google/generative-ai |
| MCP         | @modelcontextprotocol/sdk (stdio + Streamable HTTP transports) |
| Web Search  | Tavily API                                             |
| Markdown    | react-markdown + remark-gfm + react-syntax-highlighter |
| Build       | electron-vite + electron-builder                       |
| Testing     | vitest (unit) + GitHub Actions CI                      |

## Styling notes

The UI runs on [Astryx](https://astryx.atmeta.com) with the Gothic theme.
Tailwind is kept for layout utilities only; its colors and radii are mapped to
Astryx tokens in `tailwind.config.js`. A few constraints are load-bearing:

- **Layer order** (`globals.css`) — `@layer tw-base, reset, astryx-base,
  astryx-theme` puts Tailwind's preflight below Astryx's reset. Tailwind
  utilities stay unlayered so layout classes still win.
- **The universal `border-color` rule is deliberately unlayered.** Astryx's
  reset sets `border-color: currentColor`; a layered override loses to it and
  every bare `border`/`border-b` renders near-white.
- **`color-mix` in the Tailwind color map** keeps `/opacity` modifiers working
  (`bg-muted/30`, `hover:bg-accent/50`). A bare `var(--token)` drops the alpha.
- **Gothic's tokens are `@scope`d to `[data-astryx-theme="gothic"]`**, set on
  `<html>` in `index.html` along with `data-theme="dark"` (which drives
  `color-scheme`). Gothic is dark-only, so no runtime theme provider is needed.
- **`components/ui/` wraps Astryx** rather than exposing it directly, so feature
  components keep their existing props. Astryx's `Button` needs a string `label`
  and takes icons via `icon` (children render in a block span, so a leading
  `<svg>` would wrap onto its own line); `Dialog` defaults to `width: 400px`, so
  the wrapper maps the consumers' `max-w-*` class to its `width` prop.
- **`Input`/`Textarea` stay native elements** styled with Astryx tokens.
  Astryx's `TextInput`/`TextArea` are Field-wrapped: they require a `label`, use
  `onChange(value, e)`, and put `className` on their outer wrapper — but the call
  sites need it on the control itself (heights, `pl-8` to clear an overlaid icon,
  `flex-1`), and the composer reads the textarea's own `selectionStart`.
- **Astryx's `size` props control height, not text size.** Its components render
  labels at the 16px body base regardless, so each wrapper sets the type
  explicitly: `Button` maps size to `text-sm`/`text-xs`/`text-base`, `TabList`
  uses `[&_button]:text-sm`, and `Selector` needs both `[&_*]:text-inherit` (the
  trigger label sits in an inner span) and `renderOption` (the dropdown portals
  outside the trigger, so it can't inherit). Miss any of these and that surface
  silently jumps to 16px while everything around it stays 11–12px.

### Type scale

Fustat for UI, JetBrains Mono for code and figures. Six sizes, deliberately:

| Size | Use |
|------|-----|
| 11px | metadata, badges, chips, hints |
| 12px | default UI text — labels, buttons, rows, inputs |
| 14px | sidebar title, panel/section headings, markdown body |
| 16px | markdown headings (from `prose`) |
| 18px | dialog titles |
| 20px mono | the headline stat figure |

The only arbitrary size in use is `text-[11px]`; everything else comes from
Tailwind's scale. Adding new `text-[Npx]` values (there were 9px and 10px tiers
before) is what makes a column read as "several different fonts".

Both fonts are bundled in `src/renderer/src/assets/fonts` (latin + latin-ext
variable subsets, OFL-1.1) because Gothic names them in its tokens but ships no
`@font-face`, and the app must render offline.

## Data Storage

All data stays local:

- **Database**: `~/Library/Application Support/Elrond/elrond.db` (SQLite)
- **API Keys**: macOS Keychain under `com.elrond.app`
- **Cloned Repos**: `~/Library/Application Support/Elrond/repos/`
- **Attachments**: `~/Library/Application Support/Elrond/attachments/`

Messages persist bounded model-facing tool results (including arguments and
errors). Moderator rows retain stable issue IDs and debate termination reasons;
user rows and turn stats retain the final turn outcome. Non-debate, single-agent
and cancelled turns also have explicit outcomes. Each tool-loop provider request
has its own input estimate; the stats rail sums requests and labels all token and
cost figures as estimates. Reused single-agent syntheses do not add token cost.

The [benchmark harness](benchmarks.md) supplies its own in-memory database,
providers and event sink without loading app services. It compares the original
prompt/stopping behavior with the improved pipeline before any Jev integration.

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
- **Secrets**: header/env credentials are stored in the Keychain (`mcp:<serverId>:<field>`); SQLite only ever holds a `__KEYCHAIN__` sentinel. The bundled OAuth presets (Linear, Notion, Sentry) connect through the `mcp-remote` stdio bridge, which handles the browser flow and token cache itself.
- **Native OAuth** (`src/main/mcp/oauth.ts`): HTTP servers with no configured Authorization header get the SDK's OAuth 2.1 flow on 401 — dynamic client registration, PKCE, system-browser handoff, and a loopback callback server on `127.0.0.1:17872`. Client registration and tokens live in one Keychain entry per server (`mcp:<id>:oauth`), refreshed automatically and swept on server delete. Authorization failures don't auto-retry (each attempt opens a browser tab); the user restarts the flow via Reconnect.
