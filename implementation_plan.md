# Implementation Plan — Orchestration improvements and optional Jev mode

Produced by a structured multi-model debate (2 agents, 3 rounds, consensus reached) orchestrated on 2026-10-03 against repo revision `7fe4439`. Every file/line reference below was verified against the working tree during the debate.

## Outcome

Elrond's deliberation pipeline gets improved in ordered phases:

- **Phase A** — prompt-structure and semantics fixes with no new dependencies: debate rounds focused on named, stable disagreements; honest termination reasons (stopping no longer masquerades as agreement); accurate per-call token accounting; tool results surfaced out of the tool loop.
- **Phase B** — a benchmark harness, built *before* any Jev gating, that measures answer quality, latency, and cost across modes and later calibrates thresholds.
- **Phases C–F** — an optional, opt-in **Jev mode**: TypeSafe's Jev model (a System One judge — Choice/Score/Noul primitives returning probabilities and confidence) provides structured judgments for pre-flight capability routing and convergence gating. Generative models continue to produce all answers, critiques, and syntheses; Jev never generates user-facing text. When Jev is unavailable, uncertain, or uncalibrated, the pipeline behaves exactly like the improved Phase-A pipeline.

The core question — whether Jev mode improves quality, latency, and cost over the current workflow — is deliberately **not assumed**: the benchmark harness answers it with measured data, and Jev's convergence gating ships in shadow mode (logging verdicts without acting) until calibration proves it.

## Rationale

Decision criteria: answer quality, latency, and cost vs. the current workflow; consistent stage prompts with clear responsibilities; reduced manual model/tool configuration; evidence-based judgment of answers and convergence; explainable decisions; graceful fallback.

### Verified defects in the current pipeline (these block the criteria regardless of Jev)

- **Stopping is conflated with agreement.** Fewer than two responding agents reports `converged: true` (`src/main/orchestrator/index.ts:415-420`), and a malformed or failed moderator verdict also fails safe to converged (`src/main/orchestrator/prompts.ts:93-113`). Any benchmark that labels "converged correctness" is meaningless until this is fixed — so it is a prerequisite, not polish.
- **Follow-up rounds are unfocused.** The moderator's `disagreements` list is persisted and shown in the UI but never fed into the next round's `getDebateRoundPrompt` (`index.ts:368-377`, `prompts.ts:7-45`); every round repeats generic critique-and-revise.
- **Tool evidence never leaves the tool loop.** `runToolLoop` holds every tool result internally (`toolLoop.ts:188-196`) but returns only `{content}` (`toolLoop.ts:136`), so nothing downstream can judge whether a position is actually supported by retrieved evidence.
- **Token figures undercount multi-iteration tool turns.** Each tool-loop iteration re-emits `stream:start` with the grown conversation estimate (`index.ts:96-99`) and the renderer overwrites the same key (`src/renderer/src/stores/sessionStore.ts:332-337`) — but each iteration is a separately billed API call, so the real input cost is the *sum*, not the last value.
- **Everything is manual.** Model choice is hand-configured slots (`src/shared/types.ts:79-85`); web search and MCP tools are user toggles (`types.ts:268-271`); all connected MCP servers' tools go to every agent during fan-out and debate (`index.ts:261-277`).

### Why Jev fits the judging role — and only that role

Jev's batched atomic questions are cheap and parallel (TypeSafe docs: batching into one call is "12.2x cheaper and 10.0x faster"), and Choice/Score/Noul return calibrated probability distributions code can gate on. Its documented jagged edges (jev-1.13) dictate the design constraints adopted here:

- **No generation** — disagreement summaries and all user-facing prose come from generative models.
- **No large states** — Jev judges compact issue/excerpt payloads, never whole positions or transcripts (accuracy falls with irrelevant context).
- **Option-order sensitivity** — Choice questions get shuffle-and-check tests.
- **Adversarial content caution** — routing judgments stay low-stakes and are capped by existing user permissions.
- **Confidence measures distribution shape, not correctness** — thresholds start conservative (per TypeSafe guidance, ~0.6 floor; higher for consequential actions) and ship only after calibration on the benchmark.

### Rejected or deferred alternatives

- **Jev scoring whole positions for "evidence support"** — rejected (conceded in debate): nothing to score against, and it collides with the large-state weakness.
- **A model-quality registry (modality, tool support, measured quality, latency, price)** — deferred: Elrond has no in-app quality measurements today; invented rankings are false precision. v1 model selection uses static facts plus user configuration; learned rankings later derive from benchmark outcomes.
- **Automatic single-agent routing for "simple" tasks** — deferred to recommend-only in v1: no validated "simple" signal exists yet, and a misclassified multi-perspective task would silently lose independent scrutiny. (Dissent recorded: one debater holds this is the largest latency/cost lever and should ship sooner; the adopted plan gates auto-act on benchmark validation.)
- **Replacing the generative moderator entirely with Jev** — rejected: Jev cannot generate the disagreement phrases the UI and the focused-round prompts depend on.

## Scope and Acceptance Criteria

**In scope:** Phases A–F below.
**Out of scope:** replacing any generative provider with Jev; changing the synthesis contract; providers beyond TypeSafe; tool-evidence claim verification and learned model rankings (explicit follow-up, Phase G).

Acceptance criteria:

1. **Focused rounds.** Debate round N>1 prompts name the unresolved disagreements from round N-1 as stable issue IDs. Agents report, per round, which issues they still dispute, any new issues, and may reply `UNCHANGED`; an `UNCHANGED` reply preserves the agent's previous position verbatim (the marker itself is never stored as a position, and the prior position flows through to synthesis).
2. **Honest termination.** A finished turn carries exactly one termination reason: `converged` / `stagnated` (no position changed while known issues stay open) / `budget_exhausted` (round cap reached with open issues) / `degraded` (moderator failure or <2 responding agents). `converged` is never emitted for failures. While the debate continues, no termination reason is emitted (the field is absent/null on continuing-round events, which also exist — `index.ts:455-465`).
3. **Accurate accounting.** Input tokens accumulate across tool-loop iterations per call (no overwrite); figures derived from chars÷4 are labeled as estimates.
4. **Automatic, bounded routing.** With Jev mode on and a healthy key: web/repo/MCP capability gating and agent-set selection happen automatically, strictly within capabilities the user has already configured and permitted, each decision recorded and shown (question, probability, confidence, threshold). Routing can never reduce participation below two agents when debate is enabled; single-agent runs happen only by explicit user action.
5. **Convergence gating with a floor.** The generative moderator always runs after round 1 (it creates the issue inventory) and whenever agents report new issues or issue coverage is incomplete. Jev may end the debate only from round 2 onward, over a non-empty, fresh issue inventory, on a high-confidence all-resolved verdict — in which case the moderator's blocking call is skipped and the UI banner shows "Jev: estimated agreement, p=…, confidence=…" without invented disagreement phrases. Whenever the debate continues, the generative moderator runs and refreshes the issue list.
6. **Local fallback parity.** If Jev fails or is uncertain mid-run, the pipeline falls back *from that point*: already-resolved routing decisions stand (no replay of completed work), and the corrected Phase-A generative moderator path takes over. With Jev entirely absent, the run is identical to the Phase-A pipeline, plus a notice. Cancellation mid-Jev-call aborts cleanly.
7. **Measured verdict.** The benchmark harness runs a labeled, categorized prompt set across modes (current / Phase A / Jev shadow / Jev active) in an isolated environment that never touches the user's database or sessions, and reports: quality non-inferiority, held-out false-stop rate, rounds used, p50/p95 wall time, accumulated tokens, and cost. Thresholds ship only after calibration; ~20 prompts is a smoke test, not calibration.

## Implementation Plan

Ordered; later phases depend on earlier ones. New files are marked.

### Phase A — pipeline honesty and focused rounds (no new dependencies)

1. **Focused debate prompts** (`src/main/orchestrator/prompts.ts`, `index.ts`). Extend `getDebateRoundPrompt` to accept the prior verdict's disagreements as stable issue IDs (`I1: <phrase>`, …) and require a structured status line in replies (issues still disputed, new issues, or `UNCHANGED`). Extend `getModeratorPrompt` to carry and update the issue list across rounds (IDs stable). In `index.ts`, thread `verdict.disagreements` from round N into round N+1's prompts (today they stop at `roundSummaries`, `index.ts:343,466`).
2. **UNCHANGED semantics** (`prompts.ts`, `index.ts`). When a reply is `UNCHANGED`, keep `ag.position` as-is — note `splitDebateResponse` currently makes any reply the new position on a format miss (`prompts.ts:49-60`, assigned at `index.ts:390-392`), so detection must run before assignment. Test that a preserved position flows through to synthesis.
3. **Termination reasons** (`src/shared/types.ts:170-179`, `index.ts`, renderer). Add `terminationReason` (nullable; emitted only when the turn actually ends) to `ModeratorVerdictEvent` and the persisted moderator row. Mapping: <2 responding agents → `degraded`; moderator parse/call failure → `degraded`; round cap with open issues → `budget_exhausted`; all agents `UNCHANGED` while known issues remain open → `stagnated`; genuine agreement → `converged`. All-UNCHANGED with no known open issues is not auto-stagnated — the moderator decides. Renderer chip per reason (chat components + `sessionStore.ts`).
4. **Tool-result surfacing** (`src/main/orchestrator/toolLoop.ts`). Return `{content, toolResults}` — the data already exists in the loop's message list (`toolLoop.ts:188-196`); persist tool results with the agent message. No behavior change; unlocks Phase G and benchmark evidence metrics.
5. **Per-call usage accounting** (`index.ts:96-99`, `sessionStore.ts:332-337`). Accumulate input tokens across tool-loop iterations (per-iteration delta or sequence number on `stream:start`) instead of overwriting one key. Label chars÷4 figures as estimates (`types.ts:244-255`).

### Phase B — benchmark harness (before any Jev gating)

6. **Harness** (new `scripts/bench/` + `make bench`; labeled prompts in `bench/prompts/`). Drives `startDeliberation` with fixed agent configs over a categorized prompt set; records per-phase calls, rounds, accumulated tokens, wall time, termination reason, and the final synthesis for blinded human quality labeling; emits a mode-comparison table. **Isolation prerequisites** (unstated seams today): an injectable DB path — `getDb()` opens the user's live `~/Library/Application Support/Elrond/elrond.db` — and an event-capture seam, since `send()` targets the first `BrowserWindow` (`index.ts:42-52`); headless runs need a sink, not a window. Acceptance #7's "never touches user sessions" is tested here. Used first to validate Phase A vs. current, later for Jev calibration.

### Phase C — Jev client

7. **Typed client** (new `src/main/orchestrator/jev.ts` + co-located vitest tests). `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, batched questions per call, request timeout, exponential backoff on 429/529, abort-signal support; typed answers with probabilities and confidence (Noul confidence = |2p−1|). API key in the macOS Keychain under a new `KeyProvider 'typesafe'` (`types.ts:75`), following the existing provider-key pattern. Tests: request shaping, gating math, fallback on timeout/429/529/invalid payloads, Choice option-order shuffle consistency. Include a latency/cost spike — absolute numbers are not published in the docs.
8. **Compact judgment-input contracts** (same module; defined before any gating lands). Routing state = user prompt + capability inventory (names only). Convergence state = issue list with short per-agent stance excerpts, code-truncated; never full positions, transcripts, or tool output.

### Phase D — Jev mode: pre-flight routing (opt-in)

9. **Routing call** (before context assembly, `index.ts:216`). One batched Jev call: Noul "needs current web information"; Noul "references a code repository"; one Noul per connected MCP server's relevance; Choice over task-type buckets, mapped in code to which enabled agents participate (map keeps ≥2 agents whenever debate is on); Noul "simple, low-stakes task". Gate at calibrated confidence (conservative ~0.6 floor until Phase B says otherwise); below threshold or on any error → the user's current manual toggles. The simplicity signal only *recommends*: a UI chip offering single-agent for the *next* turn (a mid-run recommendation is unactionable for the current turn) — it never changes participation automatically and is visibly labeled unvalidated until benchmarked. Every automatic decision is recorded and surfaced.

### Phase E — Jev mode: convergence gating

10. **Gating** (`index.ts` debate loop). Round 1 always runs the generative moderator — the issue inventory starts empty (`index.ts:343`) and "all resolved" over an empty list must never end a debate. From round 2: first detect dead rounds in code (all `UNCHANGED` + open issues ⇒ `stagnated`, no Jev call); if agents reported new issues or stance coverage is incomplete/truncated ⇒ generative moderator (Jev over stale issues cannot see new disagreements); otherwise one batched Jev call — per open issue, Noul "the agents' positions now substantively agree on this issue" (optionally Noul "another round would likely change positions"). High-confidence all-resolved ⇒ end as `converged`, skip the moderator's blocking call (banner per acceptance #5). Anything else ⇒ existing generative moderator unchanged. Until Phase-B calibration, Jev runs in **shadow mode**: verdicts logged next to the moderator's, deciding nothing.

### Phase F — settings and explainability

11. **Settings**: Jev mode toggle (default off), TypeSafe key entry, threshold fields with calibrated defaults, shadow-mode switch. **Chat UI**: routing-rationale chips; Jev/moderator verdict banners with probability, confidence, and termination reason; judgments persisted with the turn (moderator-row JSON or a small new table — implementer's choice).

### Phase G — follow-up (explicitly not v1; requires benchmark evidence)

Tool-evidence claim verification (Jev Nouls over claim+excerpt pairs built from Phase A step 4's toolResults) feeding synthesis; learned model-selection rankings derived from benchmark outcomes; auto single-agent routing once the simplicity signal is validated; billed-usage reconciliation if chars÷4 estimates diverge materially (>~20%) from provider dashboards.

## Testing Strategy

- **Unit** (vitest, co-located, `make test` per `docs/development.md`): prompt builders include issue IDs, status-line instruction, and UNCHANGED handling; UNCHANGED preserves the prior position through to synthesis; termination-reason mapping covers all four terminal paths plus the continuing-round null; toolLoop return shape; usage accumulation across iterations; `jev.ts` client (fallbacks, shuffle-check, abort).
- **Integration** (mocked Jev client): acceptance #6 — late-failure fallback keeps resolved routing and switches to the generative moderator without replaying work; full-absence fallback produces prompt-identical Phase-A runs; #5 — moderator always runs on round 1, on new issues, and on incomplete coverage; empty-inventory fast-stop is impossible; #4 — an unconfigured capability requested by routing is never enabled, and participation never drops below two with debate on; cancellation mid-Jev-call.
- **Benchmark** (Phase B harness): Phase A vs. current first; then Jev shadow-mode agreement rate against the generative moderator; then calibrated Jev mode vs. Phase A on quality non-inferiority, held-out false-stop rate, p50/p95 latency, and cost. Runs in isolation (own DB, event sink).
- These are planned checks; nothing has been executed yet.

## Constraints and Open Questions

**Settled constraints:** Jev never generates user-facing text; judgment states stay compact; routing never exceeds user-configured permissions nor reduces participation below two agents with debate on; fallback target is the Phase-A pipeline, applied locally from the point of failure; thresholds ship only after benchmark calibration; Jev mode is opt-in and shadow-first.

**Implementation discretion:** issue-ID and status-line exact format; routing bucket taxonomy; judgment persistence shape; harness output format; DB/event-sink injection mechanism.

**Open questions — all non-blocking for Phases A–C:**
- Jev's absolute pricing and latency are unpublished; the Phase-C spike measures them. If Jev calls are not clearly cheaper/faster than the moderator call they replace, Phase E's fast path loses its point (its design is unaffected; its value is what Phase B measures).
- Whether per-call chars÷4 accumulation suffices for fair cost comparison, or billed-usage reconciliation is needed (Phase G trigger).
- Benchmark set size and composition for trustworthy calibration (≥20 prompts as smoke test now; a larger categorized set before any default-on decision).

**Recorded dissent:** one debater holds that automatic single-agent routing for simple tasks is the largest latency/cost lever and should ship in v1; the adopted plan ships it recommend-only because an unvalidated misclassification silently removes independent scrutiny.

**Readiness:** Phases A–C are ready to implement now. Phases D–F are ready in design but their activation decisions (thresholds, default-on) are blocked on Phase B/C measurements by construction. Phase G is deferred work, not blocked work.

## Verification Status

- Repository inspected at `7fe4439` with a clean working tree; all file/line references above were verified by the orchestrator against that tree during the debate.
- Jev documentation was fetched live from docs.typesafe.ai on 2026-10-03 (introduction, API reference, confidence, jev-1.13 jagged edges, coding-agents guidance, confidence-routing pattern); absolute pricing/latency were not published there and are treated as assumptions to measure.
- The debate ran three rounds to consensus (final confidences 85 and 93). Draft r1 of this plan was reviewed by both agents in round 2 and draft r2 in round 3; the round-3 corrections (round-1 moderator bootstrap, UNCHANGED preservation, nullable termination reason, local fallback parity, harness isolation seams, recommendation actionability) are incorporated above but this final revision itself was not re-reviewed by the agents.
