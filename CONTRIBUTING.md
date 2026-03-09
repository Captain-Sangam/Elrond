# Contributing to Elrond

Thanks for your interest in contributing! Elrond is an open-source multi-agent deliberation system and we welcome contributions of all kinds.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/elrond.git`
3. Install dependencies: `npm install`
4. Start development: `npm run dev`

## Project Structure

```
src/
  main/                     Electron main process (Node.js)
    db/                     SQLite database layer
    ipc/                    IPC handlers (renderer ↔ main bridge)
    orchestrator/           Deliberation pipeline
      providers/            AI provider adapters
        types.ts            AgentProvider interface
        openai.ts           OpenAI implementation
        anthropic.ts        Anthropic implementation
        google.ts           Google implementation
      prompts.ts            Debate + synthesis prompt templates
    keychain.ts             macOS Keychain wrapper
  preload/                  Electron preload (contextBridge)
  renderer/                 React frontend
    components/             UI components (shadcn/ui based)
    stores/                 Zustand state stores
  shared/                   Types shared between main + renderer
```

## Adding a New Provider

The most common contribution is adding a new AI provider. Here's how:

### 1. Implement the `AgentProvider` interface

Create a new file at `src/main/orchestrator/providers/yourprovider.ts`:

```typescript
import type { AgentProvider, ChatMessage, StreamChunk } from './types'

export class YourProvider implements AgentProvider {
  readonly name = 'yourprovider'

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    // Initialize your client with apiKey
    // Send messages and stream back chunks
    // Each chunk should yield { delta: string }
  }
}

export async function listYourProviderModels(apiKey: string): Promise<string[]> {
  // Return available model names
}

export async function testYourProviderKey(apiKey: string): Promise<boolean> {
  // Make a minimal API call to verify the key
}
```

### 2. Register the provider

Add it to the providers map in `src/main/orchestrator/index.ts` and update the IPC handlers in `src/main/ipc/agents.ts` and `src/main/ipc/keys.ts`.

### 3. Update the shared types

Add the new provider name to the `ProviderName` union in `src/shared/types.ts`.

### 4. Update the UI

Add the provider to the settings dialog, setup wizard, and agent panel color map.

## Code Style

- TypeScript throughout, strict mode enabled
- React functional components with hooks
- Zustand for state management
- shadcn/ui patterns for UI components
- No unnecessary comments — code should be self-documenting

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear commit messages
3. Ensure the project builds: `npm run build`
4. Open a PR with a description of what changed and why

## Improving the Debate Prompts

The debate and synthesis prompts are in `src/main/orchestrator/prompts.ts`. These are the core IP of the project and the most impactful area for iteration. If you have ideas for better prompts, we'd love to see them — please open an issue first to discuss the approach.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
