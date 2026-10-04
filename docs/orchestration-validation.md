# Orchestration implementation validation

Implemented scope: Phase A and Phase B of `implementation_plan.md`.
Jev client, routing, convergence judging, settings (C–F), and follow-up G are
deferred. The original plan is unchanged; no dependencies were added.

| Requirement | Implementation and verification |
| --- | --- |
| A1: focused rounds and stable issues | `prompts.ts` requires disputed/new-issue reports; `runner.ts` carries the issue inventory into subsequent prompts. Prompt tests cover ID preservation, rewording and non-recycling; runner tests verify focused round-two prompts. |
| A2: preserved `UNCHANGED` positions | Parsed before position assignment; the prior answer is persisted and passed into synthesis. Runner tests verify exact whitespace preservation and that the marker never replaces the answer. |
| A3: honest outcomes | Continuing rounds carry null; agreement, stagnation, round limits and failed/incomplete reviews are distinct. No-inventory unchanged replies still get moderation. Runner, history parser, store, migration and IPC tests verify event/persistence/reload paths, including legacy parse failures. Non-debate, single-agent and cancelled turns have explicit outcomes too. |
| A4: surfaced tool evidence | The loop returns the same bounded result text sent to the model, arguments, IDs, server/tool names and error flags. Pipeline tests verify successful/error evidence survives message persistence; IPC tests verify retrieval and JSON export. |
| A5: per-call accounting | Every tool-loop request gets its own ID and input estimate. Store/derived-stats tests verify accumulation and same-ID deduplication. Returned output estimates are used for preserved answers, and reused synthesis is not billed twice. Panels and the stats rail label estimates. |
| B6: isolated harness | `make bench`, `scripts/bench/`, categorized/referenced `bench/prompts/smoke.json`. Each run has its own in-memory database and event sink. Tests reject Electron, app DB and Keychain imports, verify fixed agents, mode behavior, failed calls, cancellation, round counts and pricing. |
| B6: comparison and human review | Per-phase calls, accumulated estimates, p50/p95 time, rounds, stop reasons, synthesis, category tables, randomized quality-review files and separate stop-review files. Label/report tests verify pairing, minimum held-out counts, non-inferiority and false-stop bounds; fixtures/incomplete labels cannot pass. |

Verification commands succeeded:

- `npm run typecheck` — main and renderer, including benchmark sources.
- `npm test` — 415 tests across 26 files.
- `npm run build` — main, preload and renderer production bundles.
- `make bench` — 20 prompts × two modes, 40 isolated offline fixture runs;
  per-call sums and blind-file contents checked from generated artifacts.
- Frozen baseline prompts compared directly with Git revision `7fe4439`;
  only the provenance comment differs.
- `git diff --check` — no whitespace errors.

The response UI also presents the leading `STATUS` protocol as a neutral issue
summary and hides partial metadata during streaming. Expected debate stops use
neutral styling; incomplete reviews retain their warning. Parser tests cover
valid, partial and malformed headers. An isolated Electron render verified
shared Fustat typography (14px body, 16px headings) across agent, debate and
synthesis panels, with JetBrains Mono code at 12px. No user database was opened.

Live smoke comparison completed: 20 prompts × two modes (40 runs), using the
existing local `llama3.1:latest` and `gemma3:latest` models with recorded digests.
All 40 runs produced a synthesis; call totals and round counts were checked
against the captured call records. The exact compiled runner is preserved with
SHA-256 `20fe4112f0498e8cc16aebe28f46e5b609d8114136406481aaca1828d63bf56d`.
This snapshot predates the per-call abort-listener cleanup; that final change
is covered by cancellation/listener tests and a separate live runtime check.
The final live check completed both modes without an abort-listener warning.
Subsequent persistence checks also verify that synthetic moderator verdicts
store zero generated tokens and actual reviews store their returned estimate.

| Local smoke metric | Baseline | Phase A |
| --- | ---: | ---: |
| Mean rounds | 2.95 | 2.80 |
| p50 wall time | 47.019 s | 47.533 s |
| p95 wall time | 101.670 s | 85.510 s |
| Estimated input tokens, total | 223,927 | 235,419 |
| Estimated output tokens, total | 64,940 | 61,048 |
| Missing syntheses | 0 | 0 |

Phase A recorded five incomplete moderator reviews as `degraded`, rather than
agreement. Median latency did not improve in this small local sample; the
lower p95 and round count are descriptive smoke results, not evidence of a
general performance improvement.

Quality non-inferiority and held-out false-stop conclusions remain **pending**
blinded human labels and a larger frozen held-out set. The 20-prompt smoke test
cannot establish calibration or justify Jev thresholds. Local model USD rates
are zero; power/hardware costs are excluded. Token counts are estimates rather
than provider usage. See [the benchmark instructions](../bench/README.md).
