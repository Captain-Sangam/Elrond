# Review: feat/subscription-auth

- **Reviewed:** `main` `fc7d385` → `HEAD` `500f125` (3 commits, 30 files), clean working tree.
- **Plan:** `.agents/tasks/debate-subscription-auth.md`, which covers the subscription-login commit. Plan usage, the opt-in for CLI MCP servers and the per-server re-check came later at the user's explicit request. Going beyond the plan was not counted as a requirement miss. Contradicting the plan's still-valid safety decisions was: no token reading, no fallback to API billing, API key mode as the default, never `--bare`.
- **Criteria:** coding standards and repo structure, documentation, no over-complication, plus any real bugs.
- **Status:** all eight findings applied, left uncommitted (see Applied).

**Overall:** the subscription-login work follows the plan and is well tested. The opt-in for CLI MCP servers has two real holes in its safety guarantees (findings 1–2). Both have small fixes, and both should be fixed before merging. Everything else is minor.

## Findings to fix

**1. Claude: an unselected MCP server can run if your Claude settings already pre-approve it.**
- **Where:** `src/main/orchestrator/providers/cli.ts:351-360`
- **Severity / type:** medium · security · implementation defect
- **Problem:** with CLI servers selected, Claude runs without `--safe-mode` because your MCP servers need your user config. `--permission-mode dontAsk` refuses anything not approved in advance, but it still honours `permissions.allow` rules from your Claude settings. So a server you left unselected runs without asking if a rule there allows it.
  - This contradicts `docs/features.md:31` ("calls to anything else are refused").
  - Today `~/.claude/settings.json` has no `mcp__` allow rules, so you aren't currently exposed.
- **Ruled out:** dropping user settings with `--setting-sources project` also drops your MCP servers. Verified live: no tools loaded.
- **Fix:**
  - Read the `mcp__…` entries in `permissions.allow` from `${CLAUDE_CONFIG_DIR ?? ~/.claude}/settings.json` and from the macOS managed settings file (`/Library/Application Support/ClaudeCode/managed-settings.json`).
  - Pass every rule whose server isn't selected to `--disallowedTools`. Deny rules beat allow rules.
  - If a file can't be read, treat it as having no rules, and read nothing from those files except `permissions.allow`: settings can carry an `env` block with keys.
- **Scope:** in scope.

**2. Codex: with servers selected, a custom provider in `config.toml` could send calls to a paid API account.**
- **Where:** `src/main/orchestrator/providers/cli.ts:410-418, 434`
- **Severity / type:** medium · security (billing) · implementation defect
- **Problem:** to use your MCP servers, the run has to load `~/.codex/config.toml` (it drops `--ignore-user-config`). A `model_provider` set there to a custom provider with its own API key variable or base URL would bill that account. Neither the removed environment variables nor `forced_login_method="chatgpt"` covers this. That breaks the plan's "no fallback to API billing".
- **Fix:** add `-c model_provider="openai"` in `codexMcpArgs`. Verified live: the run succeeds and the MCP call still works.
- **Scope:** in scope.

**3. Switching modes quickly can move agents onto the wrong backend's models.**
- **Where:** `src/renderer/src/components/settings/SubscriptionAuth.tsx:54-74`
- **Severity / type:** low · bug · implementation defect
- **Problem:** `switchMode` waits for the setting to save and the key to load, then for `listModels`, and then remaps agents. Nothing checks whether a newer switch happened in between. Example: switch to API, then Subscription, then API again while the first list is still loading. The first switch's list was fetched under Subscription, so agents get the CLI aliases while the mode is API. A plain "is the mode still the same?" check passes in that case.
- **Fix:** keep a generation counter in a ref, bump it at the start of every switch, and skip the remap if it changed while the list was loading.
- **Scope:** in scope.

**4. A Codex MCP server name containing a dot breaks every run with servers selected.**
- **Where:** `src/main/orchestrator/providers/cli.ts:410-418`
- **Severity / type:** low · bug · implementation defect
- **Problem:**
  - Codex accepts names like `a.b` (verified with `codex mcp add` in a throwaway Codex home).
  - The override `-c mcp_servers.a.b.enabled=false` then makes Codex fail to load its config ("failed to load bootstrap configuration"), so the agent call errors out.
  - Quoting the key doesn't help: Codex takes the quotes literally (verified).
- **Fix:** if any unselected name isn't `[A-Za-z0-9_-]+`, fall back to `--ignore-user-config`. The run then works without MCP servers, the same as the existing fallback when the server list can't be read.
- **Scope:** in scope.

**5. The architecture and contributor docs don't describe the subscription adapters.**
- **Where:**
  - `docs/architecture.md:43` lists the provider adapters without the CLI one.
  - `docs/architecture.md:172-176` says Elrond's MCP servers "expose their tools to every agent", which isn't true for subscription agents.
  - `docs/CONTRIBUTING.md:119-128`: the adapter template's comment still says options are `{ signal, tools }`, with no `toolsAllowed` and no `tool_activity` chunk.
- **Severity / type:** low · docs · implementation defect
- **Fix:** one or two lines in each place, noting that subscription agents use their CLI's opted-in servers and how `toolsAllowed` and `tool_activity` work (`src/main/orchestrator/providers/types.ts`).
- **Scope:** in scope.

**6. The setup wizard forgets a tested API key after you toggle to Subscription and back.**
- **Where:** `src/renderer/src/components/settings/SubscriptionAuth.tsx:59` and `src/renderer/src/components/onboarding/SetupWizard.tsx:265-266`
- **Severity / type:** low · requirement miss (plan step 7: "idle unless a tested key exists")
- **Problem:** every mode change reports not ready, and the wizard turns that into `idle`, so a key that already passed its test has to be tested again.
- **Fix:**
  - Pass the mode along: `onReadyChange(ready, mode)`.
  - In the wizard, remember which providers passed a key test, and keep `valid` when returning to API mode with a tested key.
- **Scope:** in scope.

**7. The MCP chooser lives inside `SubscriptionAuth.tsx`, has two buttons per row doing the same thing, and its save error is unhandled.**
- **Where:** `src/renderer/src/components/settings/SubscriptionAuth.tsx:127-391` (`CliMcpPicker`, `CliMcpDialog`, `ServerColumn`, `statusBadge`), with the duplicate buttons at `:355` and `:377` and the unhandled save at `:146`
- **Severity / type:** low · standards · implementation defect
- **Problem:** the switch component's file also holds a roughly 265-line dialog, while `settings/` keeps dialogs in their own files (`MCPServerFormDialog.tsx`). Each row has a separate, hidden icon button with the same action as the main button. The selection is saved without awaiting or catching the result.
- **Fix:**
  - Move the chooser to `src/renderer/src/components/settings/CliMcpDialog.tsx`. That's a pure move with no new abstraction.
  - Put the chevron inside the row's main button, which leaves one click target plus the re-check button.
  - Catch a failed save and restore the previous selection.
- **Scope:** in scope.

**8. The saved plan contradicts what shipped for MCP.**
- **Where:** `.agents/tasks/debate-subscription-auth.md:18` ("No MCP bridge") and its scope section
- **Severity / type:** low · docs
- **Fix:** add a short superseded note at the top: the opt-in for CLI MCP servers was added later at the user's request (see `docs/features.md#subscription-login`), and the plan's safety decisions still stand. Keep the record otherwise unchanged.
- **Scope:** in scope.

## Dismissed

- **Cancel needs to kill the whole process group in MCP mode.** Measured live: Claude had 7 MCP child processes and Codex had 10, and all of them were gone 4 s after SIGTERM to the CLI. The CLIs clean up their MCP children.
- **`toolsAllowed && phase !== 'synthesis'` in `runner.ts` is redundant.** It mirrors the existing `withTools` line (`runner.ts:71`), which re-checks the phase the same way. It's a consistent defensive check, not added complexity.
- **Fixing finding 1 by dropping user settings (`--setting-sources project`).** That also drops your MCP servers entirely (verified live).
- **Fixing finding 1 by denying every unselected server from the CLI's server list.** That needs the roughly 30-second `claude mcp list` on every run, or a saved list that would miss servers added later. Scanning the allow rules targets the actual way an unselected server could run.

## Applied (user selected: all)

1. **Unselected servers pre-approved in Claude settings:** `unselectedMcpPreApprovals` in `cli.ts` reads the `mcp__` entries of `permissions.allow` from the user's Claude settings (respecting `CLAUDE_CONFIG_DIR`) and from macOS managed settings. Entries for servers that aren't selected go to `--disallowedTools`. Verified live: when the same server is both allowed and denied, its tools aren't offered to the model at all.
2. **Custom Codex provider could bill an API account:** `codexMcpArgs` adds `-c model_provider="openai"`. A live run with it worked, including the MCP call.
3. **Mode-switch race:** `switchMode` takes a generation id, and if a newer switch started while the model list loaded, it skips the remap.
4. **Dotted Codex server names:** if any unselected name isn't `[A-Za-z0-9_-]+`, the run falls back to `--ignore-user-config`, so it still works without MCP servers.
5. **Docs:**
   - `docs/architecture.md`: the provider list now includes the CLI adapters, and there's a new "Subscription agents" item in the MCP section.
   - `docs/CONTRIBUTING.md`: the adapter template covers `toolsAllowed` and `tool_activity`.
   - `docs/features.md`: now describes the deny rules and the provider pin.
6. **Wizard forgets a tested key:** `onReadyChange(ready, mode)`. The wizard remembers which keys passed their test and keeps them `valid` when switching back to API mode.
7. **Chooser layout:** the chooser moved to `src/renderer/src/components/settings/CliMcpDialog.tsx` (`SubscriptionAuth.tsx` went from 391 to 126 lines). Each row has one click target plus the re-check button. A failed save restores the previous selection.
8. **Saved plan:** `.agents/tasks/debate-subscription-auth.md` has a superseded note at the top.

**Validation:** `make test` passed (typecheck, 27 files and 454 tests, build). New tests cover the allow-rule filter, the provider pin and the dotted-name fallback. There's no separate lint script; the typecheck is part of `make test`.

**Remaining limits:**
- The deny list covers user and macOS managed settings, not rules a future Claude Code version might read from somewhere else.
- The UI changes from findings 3, 6 and 7 haven't been checked by clicking through the app.

**Status:** changes are uncommitted for the user to read.
