# Features

## Core Deliberation

- Three-agent fan-out with parallel streaming
- Adaptive multi-round debate — agents critique **and revise** their answers each round
- Moderator agent judges convergence after every round and stops the debate early once agents agree
- Configurable max debate rounds (1–5, default 3) and synthesizer choice
- Debate toggle — skip straight to synthesis for faster, cheaper queries
- Conversation context — follow-up questions carry full history (including attachments)

## Attachments

- Attach **images** (PNG, JPEG, WebP, GIF) and **PDFs** to any message
- Paperclip button, drag-and-drop onto the input, or paste an image from the clipboard
- Sent natively to all three providers as base64 content blocks
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

## Web Search

- Globe toggle in the message input arms a live web search for that message
- Powered by the Brave Search API (free tier; key stored in macOS Keychain)
- Top results are injected into the agents' context with instructions to cite sources
- Failures are non-fatal — the deliberation continues with a small notice

## UI & UX

- macOS-native window with hidden titlebar and traffic lights
- Session sidebar with search, starring, rename, delete
- Live stats rail (toggle in the top bar): tokens burnt per phase and per debate round, in/out split, estimated cost, elapsed timer, and consensus outcome — updating in real time as agents stream
- Scroll freely while agents stream — auto-follow only when pinned to the bottom, with a jump-to-bottom button
- Collapsible debate rounds with per-round moderator verdicts
- Syntax-highlighted code blocks (One Dark theme) with copy buttons
- Styled markdown tables, blockquotes, links, and inline code formatting
- Global keyboard shortcut (configurable)
- Menu bar tray icon — always running in background
- Cmd+/- zoom support
- Export sessions as Markdown or JSON

## Settings

- Tabbed dialog: General, Providers, GitHub, Web Search
- Per-provider model selection (live dropdowns from API)
- Debate toggle and max debate rounds (1–5)
- Custom system prompt for all agents
- Submit key preference (Cmd+Enter or Enter)
- GitHub token, organizations, and full repo index management
- Brave Search API key for web search
- Danger zone: clear history, reset keys

## Cost Awareness

Each debate round costs one call per agent plus a short moderator check, so a query that runs the full 3 rounds costs roughly 3-4x a single-round debate. The moderator usually stops well before the cap — simple questions converge in one round. Use the max-rounds setting or the debate toggle to bound cost; with debate off, a query is just the fan-out plus one synthesis call. Token counts are displayed on each panel and in the live stats rail (all figures are chars÷4 estimates).
