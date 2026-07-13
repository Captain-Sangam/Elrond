# Features

## Core Deliberation

- Multi-agent fan-out with parallel streaming — as many agents as you configure
- Adaptive multi-round debate — agents critique **and revise** their answers each round
- Moderator agent judges convergence after every round and stops the debate early once agents agree
- Configurable max debate rounds (1–5, default 3) and synthesizer choice (any agent)
- Debate toggle — skip straight to synthesis for faster, cheaper queries
- Conversation context — follow-up questions carry full history (including attachments)

## Agents & Providers

- Agents are named slots decoupled from providers — manage them in the Agents dialog (bot icon in the sidebar)
- Providers: OpenAI, Anthropic, Google (cloud, API keys in Keychain) and **Ollama** (local, keyless)
- Several agents can share a provider — e.g. two different Ollama models debating each other
- Per-agent provider + model assignment, enable/disable toggle, and synthesizer selection
- Ollama connection in Settings → Providers: server URL, test connection, discovered model list
- Local Ollama agents cost $0 in the stats rail

## Attachments

- Attach **images** (PNG, JPEG, WebP, GIF) and **PDFs** to any message
- Paperclip button, drag-and-drop onto the input, or paste an image from the clipboard
- Sent natively to the cloud providers as base64 content blocks (Ollama receives images; PDFs are noted as unsupported)
- Stored locally and re-sent with follow-up questions, so "what does page 2 say?" just works
- Limits: 10 MB per file, 5 files per message

## GitHub Code Q&A

- `/github` slash command with autocomplete popup and repo selector dropdown
- Indexed-status badges in the selector; unindexed repos offer inline "Index now" with live progress (cloning → scanning → storing) that never blocks sending
- Repo management in Settings → GitHub: searchable list with index/reindex/remove
- Organization support — configure orgs in Settings to see their repos
- Live GitHub API tools — PRs, commits, issues, branches, contributors
- Local repo indexing with SQLite FTS5 for code search
- Auto-detection of `owner/repo` patterns in prompts

### What the agents can access

| Data                                | Example Prompt                         |
| ----------------------------------- | -------------------------------------- |
| Pull Requests (with diffs, reviews) | "Summarize the last 5 PRs"             |
| Commits (with stats, files)         | "What changed in the last 10 commits?" |
| Issues (with comments)              | "List open bugs and their status"      |
| Branches                            | "What branches exist?"                 |
| Contributors                        | "Who are the top contributors?"        |
| Source Code (indexed repos)         | "How does the auth middleware work?"   |

## MCP Tools

- Connect [Model Context Protocol](https://modelcontextprotocol.io) servers in Settings → MCP; agents call their tools natively mid-deliberation (all four providers, including tool-capable Ollama models)
- Six presets ship out of the box: **Linear**, **Notion**, **GitHub**, **Sentry**, **Context7** (library docs), and **Filesystem** (local folders you pick)
- Linear, Notion, and Sentry authenticate via browser OAuth on first connect (through the `mcp-remote` bridge — requires `npx`); GitHub and Context7 take an API key; Filesystem needs no auth
- Custom servers: any stdio command or Streamable HTTP endpoint, with env vars / headers — values marked "Secret" are stored in the macOS Keychain, never in the database
- Active-server list with live status badges (Connecting / Connected / Error), expandable tool lists, enable/disable toggles, and reconnect
- Tool calls appear as inline chips in the agent panels while streaming (spinner → check or error, with args/result previews on hover)
- Tools are active during initial answers and debate rounds — agents can verify each other's claims against live data; the moderator and synthesis stay tool-free
- A sticky plug toggle in the message input arms or detaches MCP tools (persisted, on by default) — turn it off for chats unrelated to your connected services, especially with small local models
- Bounded and non-fatal: max 8 tool iterations per agent turn, results truncated at ~16k chars, failures fed back to the model as errors; models without tool support fall back to a plain answer with a notice

## Web Search

- Globe toggle in the message input arms a live web search for that message
- Powered by the Tavily search API (free tier: 1,000 searches/month, no card; key stored in macOS Keychain)
- Top results are injected into the agents' context with instructions to cite sources
- Failures are non-fatal — the deliberation continues with a small notice

## UI & UX

- macOS-native window with hidden titlebar and traffic lights
- Session sidebar with search, starring, rename, delete
- Live stats rail (toggle in the top bar): pinned session totals (tokens, in/out split, cost, total time), a full card per turn with phase-by-phase breakdown on the live turn, consensus outcomes, and an all-sessions turn counter — turns stack instead of resetting on follow-up questions
- Scroll freely while agents stream — auto-follow only when pinned to the bottom, with a jump-to-bottom button
- Collapsible debate rounds with per-round moderator verdicts
- Syntax-highlighted code blocks (One Dark theme) with copy buttons
- Styled markdown tables, blockquotes, links, and inline code formatting
- Global keyboard shortcut (configurable)
- Menu bar tray icon — always running in background
- Cmd+/- zoom support
- Export sessions as Markdown or JSON

## Settings

- Tabbed dialog: General, Providers, GitHub, Web Search, MCP
- Cloud API keys with test buttons; Ollama server URL with test connection + model list
- Per-agent model selection lives in the Agents dialog (live dropdowns from each provider)
- Debate toggle and max debate rounds (1–5)
- Custom system prompt for all agents
- Submit key preference (Cmd+Enter or Enter)
- GitHub token, organizations, and full repo index management
- Tavily API key for web search
- MCP server management: preset gallery, custom servers, secrets in Keychain, live connection status
- Danger zone: clear history, reset keys

## Cost Awareness

Each debate round costs one call per agent plus a short moderator check, so a query that runs the full 3 rounds costs roughly 3-4x a single-round debate. The moderator usually stops well before the cap — simple questions converge in one round. Use the max-rounds setting or the debate toggle to bound cost; with debate off, a query is just the fan-out plus one synthesis call. Token counts are displayed on each panel and in the live stats rail (all figures are chars÷4 estimates).
