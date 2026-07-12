# Contributing to Elrond

Thanks for your interest in contributing. Elrond is an open-source multi-agent deliberation system and we welcome contributions of all kinds — new AI providers, GitHub tools, UI improvements, bug fixes, and documentation.

## Getting Started

```bash
git clone https://github.com/Captain-Sangam/elrond.git
cd elrond
npm install
npm run dev
```

This starts Electron in dev mode with hot module replacement for the renderer.

## Project Structure

```
src/
  main/                          Electron main process (Node.js)
    db/                          SQLite database layer
      schema.ts                  Tables, indexes, FTS5, migrations
      index.ts                   DB singleton
    github/                      GitHub integration
      index.ts                   Repo listing, cloning, file indexing
      tools.ts                   Live API tools (PRs, commits, issues, etc.)
    ipc/                         IPC handlers (renderer ↔ main bridge)
      keys.ts                    Keychain CRUD
      sessions.ts                Session/message DB ops
      settings.ts                Settings DB ops
      agents.ts                  Deliberation orchestration
      github.ts                  GitHub API handlers
      shortcut.ts                Global shortcut management
    orchestrator/                Deliberation pipeline
      providers/                 AI provider adapters
        types.ts                 AgentProvider interface
        openai.ts                OpenAI streaming
        anthropic.ts             Anthropic streaming
        google.ts                Google Gemini streaming
        ollama.ts                Local Ollama streaming (OpenAI-compatible /v1)
      prompts.ts                 Debate + synthesis prompt templates
      index.ts                   Pipeline controller (fan-out, debate, synthesis)
    agentStore.ts                Agent configs (persistence, validation, seeding)
    keychain.ts                  macOS Keychain wrapper (keytar)
  preload/                       Electron preload (contextBridge)
    index.ts                     Typed API exposed to renderer
  renderer/                      React frontend
    src/
      components/
        chat/                    Core chat UI
          AgentPanel.tsx         Individual agent response panel
          DebatePanel.tsx        Collapsible debate round
          SynthesisPanel.tsx     Final synthesis (prominent styling)
          MarkdownContent.tsx    Shared markdown renderer (syntax highlighting, tables)
          MessageInput.tsx       Prompt input with /github slash command
          SessionView.tsx        Main chat area orchestrating all panels
        github/
          RepoPickerDialog.tsx   Repo browser and indexer
        layout/
          Sidebar.tsx            Session list with search
          TopBar.tsx             Titlebar drag region
        agents/
          AgentsDialog.tsx       Agent management (assignments + provider status)
        settings/
          SettingsDialog.tsx     All settings (keys, Ollama server, GitHub, shortcuts)
        onboarding/
          SetupWizard.tsx        First-launch setup flow
        ui/                      shadcn/ui primitive components
      stores/
        sessionStore.ts          Zustand: sessions, messages, streaming state
        settingsStore.ts         Zustand: preferences
        agentsStore.ts           Zustand: agents, synthesizer, Ollama connection
      lib/
        utils.ts                 Tailwind merge, formatters, cost estimation
        providers.ts             Provider labels/colors, agent metadata resolution
  shared/
    types.ts                     Types shared between main + renderer
```

## Adding a New AI Provider

The most common contribution. Each provider implements the `AgentProvider` interface. Agents are decoupled from providers — users assign a provider + model to each agent slot in the Agents dialog, and several agents can share one provider.

### 1. Create the adapter

Create `src/main/orchestrator/providers/yourprovider.ts`:

```typescript
import type { AgentProvider, ChatMessage, StreamChunk } from "./types";

export class YourProvider implements AgentProvider {
  readonly name = "yourprovider";

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    credential: string,
    signal?: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    // credential is the API key for cloud providers. Keyless local providers
    // receive their server base URL here instead (see ollama.ts).
    // Stream responses, yielding { delta: string } for each chunk
  }
}

export async function listYourProviderModels(
  credential: string,
): Promise<string[]> {
  // Fetch available models from the API
}

export async function testYourProviderKey(apiKey: string): Promise<boolean> {
  // Return true if key authenticates, false only for auth errors
  // Non-auth errors (rate limit, model not found) should return true
  // Keyless providers expose a test-connection function instead (see ollama.ts)
}
```

### 2. Register it

- Add to the providers map in `src/main/orchestrator/index.ts`
- Teach `resolveCredential()` in the same file where the credential comes from (keychain for cloud keys, settings for local base URLs)
- Add to IPC handlers in `src/main/ipc/agents.ts` (`models:list`) and `src/main/ipc/keys.ts` (`keys:test`, or a dedicated test-connection handler for keyless providers)
- Add the provider name to the `ProviderName` union in `src/shared/types.ts` (and to `KeyProvider` only if it uses the keychain)
- Update the UI: provider labels/colors in `src/renderer/src/lib/providers.ts`, key entry in the settings dialog, the provider list in the Agents dialog (`src/renderer/src/components/agents/`)

## Adding a New GitHub Tool

GitHub tools fetch live data from the GitHub API and inject it into the agent context.

### 1. Create the fetch function

Add to `src/main/github/tools.ts`:

```typescript
export async function fetchYourData(
  owner: string,
  repo: string,
): Promise<string> {
  const data = await ghFetch<YourResponseType>(
    `https://api.github.com/repos/${owner}/${repo}/your-endpoint`,
  );
  // Format as readable markdown
  return formattedString;
}
```

### 2. Add a detection pattern

Add an entry to the `TOOL_PATTERNS` array in the same file:

```typescript
{
  pattern: /\b(?:your|keywords|here)\b/i,
  tool: 'your_tool_name',
  handler: async (owner, repo, match) => {
    return fetchYourData(owner, repo)
  }
}
```

The orchestrator will automatically detect the keywords in user prompts and call your tool when a repo is attached.

## Improving the Debate Prompts

The debate and synthesis prompts in `src/main/orchestrator/prompts.ts` are the most impactful area for iteration. If you have ideas for better prompts, please open an issue first to discuss the approach.

## Code Style

- TypeScript throughout, strict mode
- React functional components with hooks
- Zustand for state management
- shadcn/ui patterns for UI components
- No unnecessary comments — code should be self-documenting
- `npm run build` must pass with no errors

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear commit messages
3. Ensure the project builds: `npm run build`
4. Open a PR with a description of what changed and why

## Reporting Issues

Use GitHub Issues. Please include:

- macOS version
- Steps to reproduce
- Expected vs. actual behavior
- Console output if applicable (View > Developer Tools in the app menu)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
