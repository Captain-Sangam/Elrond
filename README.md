# Elrond

**A multi-agent deliberation system for Mac.**

Elrond sends your prompt to multiple AI models simultaneously, has them debate each other across adaptive rounds with a moderator judging convergence, and synthesizes a final answer. Think of it as a council of AI advisors — each brings a different perspective, they critique each other's reasoning, and you get a consolidated result.

All conversations stay on your machine. API keys live in your macOS Keychain. No cloud, no telemetry, no accounts.

> Full documentation lives in [`docs/`](docs/) — see [features](docs/features.md), [architecture](docs/architecture.md), and [development](docs/development.md).

## Requirements

- **macOS 13 (Ventura)** or later
- **Node.js 18+**
- API keys for at least **two** of: OpenAI, Anthropic, Google

## Install

```bash
git clone https://github.com/Captain-Sangam/elrond.git
cd elrond
make install
make dev          # run in development mode
```

To install it as a real app (launchable from Spotlight):

```bash
make export       # packages Elrond.app into /Applications
```

## First Launch

A setup wizard walks you through:

1. **API Keys** — Enter and test keys for each provider (stored in macOS Keychain)
2. **Model Selection** — Dropdowns populated live from each provider's API
3. **Global Shortcut** — Set a keyboard shortcut to summon Elrond from anywhere (default: `Cmd+Shift+Space`)

## Getting API Keys

| Key | Where | Notes |
| --- | --- | --- |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Requires a funded API account |
| Anthropic | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | Requires a funded API account |
| Google | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Free tier available |
| GitHub (optional) | [github.com/settings/tokens](https://github.com/settings/tokens/new?scopes=repo&description=Elrond) | "Generate new token (classic)" with the `repo` scope — required to list, clone and index private repos. Configure in Settings → GitHub |
| Brave Search (optional) | [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com/register) | Sign up, subscribe to the **Free** plan (~2,000 queries/month; card required but not charged), copy the key from "API Keys". Configure in Settings → Web Search |

GitHub and Brave keys are only needed for the `/github` integration and the web-search globe toggle respectively — the core deliberation works without them.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).
