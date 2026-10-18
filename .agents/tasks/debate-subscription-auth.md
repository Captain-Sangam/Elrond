# Subscription login for Anthropic and OpenAI agents

> **Superseded in part.** This plan shipped as commit `08649e3`. The user later asked for an opt-in to MCP servers from their own Claude Code / Codex setup, so the "No MCP bridge" decision and the out-of-scope MCP items below no longer describe the app; see [docs/features.md](../../docs/features.md#subscription-login). The safety decisions still stand: no token reading, no fallback to API billing, API key mode as the default, never `--bare`.

## Outcome
**Task:** let Elrond's Anthropic and OpenAI agents run on the user's Claude (Pro/Max) or ChatGPT (Plus/Pro) subscription instead of a pay-per-token API key. The user chooses "API key" or "Subscription" per provider during setup, and Elrond finds the existing local login by itself.

**Decision:** each provider gets an **API key / Subscription** switch, in the setup wizard and in Settings. In Subscription mode, every model call runs the user's installed CLI as a child process: `claude -p` (Claude Code) for Anthropic, `codex exec` (Codex CLI) for OpenAI. The CLI uses its own login and refreshes its own tokens. Elrond never reads, stores or sends subscription tokens. Choosing Subscription detects automatically whether the CLI is installed and logged in to a subscription. API-key mode is unchanged and stays the default.

**What you give up:**
- Subscription agents answer without Elrond's MCP tools. The existing "answering without MCP tools" fallback handles this.
- Codex text arrives one complete message at a time instead of token by token.
- Codex can't read PDF attachments.
- Each call starts a process, about 1–2 s of overhead.

## Rationale
- **CLIs, not tokens (the user's choice).** Anthropic's terms restrict subscription OAuth tokens to Claude Code and claude.ai, and its servers block other clients that present them. Running the official CLIs keeps them as the client and removes any need for OAuth or refresh code in Elrond.
- **A setting per provider, not new provider names.** `anthropic_auth` / `openai_auth` (`'api' | 'subscription'`) live in the existing settings table. `ProviderName`, stored agents, message rows, colours and labels don't change. The orchestrator picks the backend on each call.
- **The CLI providers get their own internal names** (`claude-cli`, `codex-cli`). `toolLoop.ts` remembers which `provider.name:model` pairs rejected tools (`src/main/orchestrator/toolLoop.ts:145`), so separate names keep a subscription result from switching off tools for the same model in API mode.
- **No MCP bridge.** The CLI providers throw the existing `ToolsUnsupportedError` before starting a process. The tool loop already turns that into a notice and a retry without tools (`toolLoop.ts:187-191`).
- **Kept simple, as the user asked.** These were considered and rejected:
  - Snapshotting the mode per deliberation. The switch is disabled while a deliberation runs instead.
  - Process-group kill with TERM→KILL escalation, and per-call timeouts. With tools turned off, no child processes survive SIGTERM.
  - An environment allowlist. It would drop HOME, TMPDIR, proxy and locale variables. A denylist of billing and endpoint variables is enough.
  - A five-state detection result. `{ ok, detail }` supports every UI branch.

## Scope and Acceptance Criteria
**In scope:** Anthropic via `claude`, OpenAI via `codex`, the switch in the wizard and Settings, automatic detection, mode-aware model lists, $0 cost display for subscription calls, docs.
**Out of scope:** Gemini subscriptions, passing Elrond's MCP servers to the CLIs, PDF input for Codex, any token reading or refresh.

Done when:
1. Choosing Subscription with the CLI logged in to a subscription shows "ready". The wizard counts the provider toward its two-agent minimum.
2. A deliberation with subscription agents completes:
   - Claude text streams as it's generated.
   - Codex text appears one complete message at a time.
   - Moderator and synthesis calls work.
3. None of these change a subscription run: API-key or endpoint environment variables, Claude hooks, CLAUDE.md files, project AGENTS.md files, user MCP config, Codex `config.toml`, the Codex shell, or Codex web search. The one exception, user-wide `~/.codex/AGENTS.md`, is listed under Constraints.
4. Cancelling a deliberation, including right after submitting, leaves no `claude -p` or `codex exec` process running.
5. Each of these produces a readable error and never falls back to API billing: a CLI that is missing, logged out, logged in with an API key, at its usage limit, or exits halfway through an answer. Codex rejects an API-key login at run time. For Claude, see the Constraints note on `apiKeySource`.
6. Images reach both CLIs, including images from earlier turns. PDFs reach Claude. For Codex, a PDF is replaced by a note that it was omitted.
7. Subscription calls show $0 in the stats panel.
8. After a mode switch:
   - No agent keeps a model the new backend can't run.
   - Valid full Claude model names are kept and stay visible.
   - The switch can't be used while a deliberation runs.
9. Existing installs behave exactly as before until someone flips the switch.

## Implementation Plan
Order: 1 → 2 → 3 → 4 (main process, testable on its own) → 5 → 6 → 7 → 8 → 9 → 10.

1. **Mode accessor**: `src/main/agentStore.ts`. Export `getAuthMode(provider: 'anthropic' | 'openai'): 'api' | 'subscription'`. It reads the setting `${provider}_auth` and defaults to `'api'`. Put it next to `getOllamaBaseUrl` (`agentStore.ts:69`).

2. **CLI providers, new file `src/main/orchestrator/providers/cli.ts`.**
   - **`cliEnv(path)`**: returns `process.env` with `PATH = path` and these removed:
     - `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`
     - `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`
     - `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `CODEX_API_KEY`

     Every CLI invocation uses it: runs, detection and the model catalog.
   - **`runCli(cmd, args, stdin, path, signal)`**: an async generator that yields parsed JSON objects, one per line of stdout.
     - Start the process with `spawn(cmd, args, { cwd: <one empty mkdtemp dir per app run>, env: cliEnv(path), signal })`.
     - Write stdin and close it. Read lines with `readline` and skip any that aren't JSON. Keep the last ~4 KB of stderr.
     - Treat the spawn `error` event as a failure: ENOENT means "CLI not installed", and a signal that is already aborted must end the generator rather than hang it.
     - A non-zero exit throws the stderr tail. `{signal}` sends SIGTERM on abort; the per-call controller in `toolLoop.ts:165-168,196` fires it.
   - **Prompt building**:
     - Messages are labelled `System:` / `User:` / `Assistant:` and sent on stdin, never argv. The system text carries GitHub repo context and web context (`runner.ts` ~215-245), and macOS caps argv plus env at 1 MB.
     - Attachments from earlier user turns are kept, because `runner.ts:284` replays them on purpose.
   - **`ClaudeCliProvider`** (`name = 'claude-cli'`):
     - Command: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --safe-mode --tools "" --strict-mcp-config --no-session-persistence --model <m> --system-prompt "<short fixed deliberation persona>"`.
     - stdin gets one `{"type":"user","message":{"role":"user","content":[...]}}` line. For each message in order, the content holds its role-labelled text block followed by its non-text parts, mapped through the existing `toAnthropicBlock` (`providers/anthropic.ts:12`).
     - Output: yield text only from `stream_event` → `content_block_delta` / `text_delta`. Use the final `result` event only to detect errors (`is_error`). Ignore its text, which duplicates what already streamed.
     - If stdout ends with no `result` event, throw "CLI exited before finishing". Otherwise a partial answer passes the empty-answer check at `runner.ts:93`.
     - Billing guard: throw if the `system`/`init` event reports an API-key source (`apiKeySource`) instead of subscription OAuth.
     - `--safe-mode` turns off CLAUDE.md (including the user-wide one), hooks, MCP and plugins, and leaves login and model choice alone (verified in `claude --help`). Never use `--bare`: it never reads the OAuth/keychain login.
   - **`CodexCliProvider`** (`name = 'codex-cli'`):
     - Command: `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --disable shell_tool --disable hooks --disable plugins --disable apps -c forced_login_method="chatgpt" -c web_search="disabled" --sandbox read-only -C <dir> [-i <img>]... -m <m> -`.
     - All flags, feature names and config keys were checked against `codex exec --help`, `codex features list` and the 0.162.1 binary.
     - `-i` accepts several values, so it goes before `-m`, and `-` (prompt from stdin) stays last.
     - `forced_login_method` blocks an API-key login at run time.
     - `web_search` otherwise defaults to cached search, which would let synthesis add facts that were never debated.
     - stdin gets the role-labelled transcript.
     - Images from any user turn are written to the temp dir as `<uuid>.<ext from MIME>`, passed with `-i`, and deleted in `finally`. The uuid matters because parallel calls share the directory.
     - PDFs become an omission note, following `providers/ollama.ts:28`.
     - Output: yield the text of `item.completed` events where `item.type === 'agent_message'`. Throw on `turn.failed` or `error` events, and when stdout ends with no `turn.completed`.
   - Both providers throw `new ToolsUnsupportedError(model, '<CLI> subscription mode has no MCP tools')` when `options.tools` is set.
   - **`listClaudeCliModels()`** returns `['sonnet', 'opus', 'haiku', 'fable']`. These are the CLI's latest-model aliases. `sonnet` comes first because `list[0]` becomes the default when adding an agent or switching its provider (`AgentRow.tsx:47`, `AssignmentsTab.tsx:35`), and every plan tier can run it.
   - **`listCodexModels(path)`** runs `codex debug models` and returns `slug` where `visibility === 'list'`. On any failure it returns `[]`.
   - **`detectSubscription(provider, path)`** returns `{ ok: boolean; detail: string }`, with a 10 s timeout.
     - Claude: `claude auth status --json`, which must be logged in with a claude.ai subscription.
     - Codex: `codex login status`, which must be a ChatGPT login.
     - If the binary isn't found (ENOENT), the detail is "Install the CLI, then log in".

3. **Backend selection**: `src/main/orchestrator/index.ts`.
   - `resolveCredential` (`:19`): in subscription mode, return `await getShellPath()` (`src/main/mcp/shellEnv.ts:30`). The credential argument then carries the login-shell PATH, as it carries the Ollama base URL today. This fixes Finder launches, where the app inherits only the bare launchd PATH.
   - `providers` (`:36-41`): make `openai` and `anthropic` getters that return the CLI or API instance by `getAuthMode`. `runner.ts:75,113` looks up providers on every call, so `runner.ts` doesn't change.

4. **IPC**:
   - `src/main/ipc/agents.ts:28` `models:list`: in subscription mode, return the CLI list.
   - `src/main/ipc/keys.ts`: add `subscription:detect`, exposed through `src/preload/index.ts` and `ElrondAPI` (`src/shared/types.ts:312`) as `detectSubscription(provider)`.

5. **Renderer source of truth for the mode**: `src/renderer/src/stores/settingsStore.ts`. Add `authModes: { anthropic, openai }`. Read it in `loadSettings` (`:26-36`) and update it in the `setSetting` switch (`:42-61`). Everything in the renderer reads the mode from here and writes it with `useSettingsStore.setSetting`, never `window.elrond.setSetting` directly. Otherwise the cost display and the dialogs go stale.

6. **Shared switch, new file `src/renderer/src/components/settings/SubscriptionAuth.tsx`.**
   - An `API key | Subscription` toggle with a status line. Choosing Subscription runs detection straight away; a "Re-check" button stays available.
   - Any mode change resets the readiness status. A detection result that comes back after the user has switched away from Subscription is ignored.
   - Remap rule, applied after a mode change once the new model list loads:
     - Keep an agent's model if the new list contains it.
     - Also keep it when the new mode is Anthropic subscription and the model starts with `claude-`.
     - Otherwise set it to `list[0]` through `agentsStore.updateAgent`.
     - Never remap when the list is empty. `saveAgents` rejects the whole array if any model is `''` (`src/main/agentStore.ts:37-38,56-57`), and the renderer only logs that failure (`agentsStore.ts:51-55`).
   - Disabled while `sessionStore.isDeliberating` is true. A running deliberation keeps its agent list from the request, so switching mid-run would send old models to the new backend.

7. **Setup wizard**: `src/renderer/src/components/onboarding/SetupWizard.tsx`.
   - Show the switch on the OpenAI and Anthropic rows. The key input only appears in API mode.
   - Successful detection sets `keyStatus[name] = 'valid'`. Switching back to API resets it to `'idle'` unless a tested key exists. Then `canContinue` (`:52-55`) and the agent enabling in `handleFinish` (`:110`) stay correct.
   - Remove the `!key` early return at `:66` and call `listModels(name, key || undefined)`.
   - When a non-empty list loads and the current default isn't in it, select `list[0]`. Otherwise Codex would keep the default `gpt-4o`. Leave the default alone on an empty list.

8. **Settings, Agents and agent rows**:
   - `SettingsDialog.tsx`, Providers tab: use the same switch.
   - `AgentsDialog.tsx:35-46`:
     - In subscription mode (from `settingsStore.authModes`), `keyPresence` comes from `detectSubscription`, re-checked every time the dialog opens. In API mode, it is `Boolean(key)`.
     - Load models in both modes.
     - `AssignmentsTab` and `ProvidersTab` need no change.
   - `AgentRow.tsx:116-128`: when the list is non-empty and doesn't contain `agent.model`, add `agent.model` as an extra option so a kept full Claude name stays visible.

9. **Cost**:
   - `estimateCost` (`src/renderer/src/lib/utils.ts:63`) zeroes only ollama. Add a `free` flag.
   - `deriveTurnStats` (`src/renderer/src/lib/turnStats.ts:25`) takes the subscription providers from `settingsStore.authModes`, passed by its two callers (`sessionStore.ts:273`, `StatsPanel.tsx:183`).

10. **Docs**: a "Subscription login" section in `docs/features.md` (what's needed, how detection works, the limits from the Outcome section, and that user-wide `~/.codex/AGENTS.md` still applies), plus a line in `docs/CHANGELOG.md`.

## Testing Strategy
**Unit tests (proposed):** a new `src/main/orchestrator/providers/cli.test.ts` in the vitest style of `providers/*.test.ts`.
- Prompt building: role order, and that attachments from earlier turns are kept.
- Claude JSONL:
  - Delta lines yield text.
  - An `is_error` result throws.
  - The final text isn't duplicated.
  - An API-key `init` event throws.
  - A missing `result` throws.
- Codex JSONL:
  - `agent_message` yields text.
  - `turn.failed` throws.
  - A missing `turn.completed` throws.
- A non-JSON line is skipped.
- `ToolsUnsupportedError` is thrown when tools are passed.
- The remap rule, if it's pulled out as a small pure function: listed model kept; `claude-…` kept on Anthropic subscription; `gpt-4o` and `opus` remapped; empty list leaves the model unchanged.
- Fixtures are short JSON lines recorded from one real run of each CLI, with account fields removed.

**Commands:** `make test` (runs `node scripts/run-tests.mjs run`) and `npm run typecheck`. Existing runner and provider tests must still pass (criterion 9).

**Manual checks** in `make dev`, plus one Finder-launched packaged build (`make export`) for the PATH:

| Criterion | Check |
|---|---|
| 1 | Detection shows: ready, logged out, API-key login, binary missing (rename it off PATH). |
| 2, 6 | A mixed Claude-subscription + Codex-subscription deliberation, then a follow-up question about a first-turn image on each provider. A PDF on each provider: Claude answers about it, Codex shows the omission note. Two Codex agents with images in one run. |
| 3 | `ANTHROPIC_API_KEY=bogus OPENAI_API_KEY=bogus make dev`: detection and runs still use the subscription. Canary line in `~/.claude/CLAUDE.md` and a canary Claude hook don't show up in output. A deliberately broken `mcp_servers` entry in `~/.codex/config.toml` doesn't affect a Codex run. |
| 4 | Cancel mid-stream, and right after submit. Then `pgrep -fl "claude -p\|codex exec"` prints nothing. |
| 5 | Detect succeeds, then log the CLI in with an API key outside Elrond, then run: Codex errors. Claude errors if the `apiKeySource` guard exists. |
| 7 | The stats panel shows $0 for a subscription-only turn. |
| 8 | The switch is disabled during a run. After a switch, `gpt-4o` and `opus` are remapped, and `claude-sonnet-…` is kept and visible. |
| 9 | One API-key deliberation with no settings changed. |
| tools | With an MCP server enabled, subscription agents show "answering without MCP tools" and finish. |

## Constraints and Open Questions
- **Settled constraints:**
  - No token reading.
  - No fallback to API billing.
  - API mode is the default.
  - Never use `--bare`.
- **Not blocking (check during implementation, affects step 2 and the tests):**
  - The JSON field names from `claude auth status --json`.
  - The `apiKeySource` field and its values in the Claude `init` event.
  - The exact event shapes from `claude` stream-json and `codex exec --json`.

  Record them as fixtures. If `apiKeySource` doesn't exist, drop that guard. Criterion 5's run-time guarantee then covers Codex only. For Claude, it relies on the cleaned environment plus detection, which re-runs whenever the Agents dialog opens. Document that.
- **Known limits (accepted):**
  - Codex still loads a user-wide `~/.codex/AGENTS.md`. `--ignore-user-config` skips `config.toml` only, and no suppressing override was found. Project AGENTS.md files are never found because the CLI runs in an empty directory.
  - Codex has no per-token streaming.
  - Each call starts a process.
  - Usage limits are enforced by the CLI and shown as errors.
  - Cost estimates use the current mode. A turn archived after a switch (`sessionStore.ts:273` archives when the next turn starts) is priced under the new mode. It's cosmetic.
- **Left to the implementer:**
  - The exact persona text for Claude's `--system-prompt`.
  - Status wording and layout.
  - Whether the remap rule is pulled out as a pure function.
- Ready for full implementation; nothing is blocked.

## Verification Status
- **Repository:** `elrond` at `fc7d385` on `main`, clean working tree.
- **Checked:**
  - Every cited file and line in the plan.
  - Installed `claude` 2.1.295 help: `--safe-mode`, `--tools`, `--input-format`/`--output-format stream-json`, `--include-partial-messages`, `--no-session-persistence`, `--bare` semantics, model aliases, `auth status --json`.
  - Installed `codex-cli` 0.162.1: `exec` flags (`--json`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `-i`, `-C`), `features list` (`shell_tool`, `hooks`, `plugins`, `apps`), the config keys `forced_login_method` and `web_search` (values `disabled`/`cached`/`live`) in the binary, and the `codex debug models` output shape.
  - macOS `ARG_MAX` = 1,048,576.
- **Not checked:** no live model call or login-status call was made, so the JSONL event shapes, `auth status` fields and `apiKeySource` stay implementation-time checks, as listed above.
- **Review:** the final revision folds in small edits that both reviewing models proposed in the last check round. Those specific edits were checked against the code but weren't re-reviewed by the models: settings store as the mode's source of truth, the readiness reset, the AgentRow saved-model option, the wizard's empty-list guard, the alias order, and three added manual checks.
