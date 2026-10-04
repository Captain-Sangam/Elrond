# Orchestration benchmark

The harness compares the behavior at `7fe4439` with Phase A. It uses fixed
agent/model configurations, the same call instrumentation in both modes, and
one fresh in-memory SQLite database per run. It never imports the application's
database singleton, Electron windows, Keychain, attachment store, web search,
GitHub or MCP manager. Jev is not integrated.

## Run

```sh
make bench                                      # synthetic offline smoke test
cp bench/config.example.json bench/config.local.json
# Edit model tags/baseURL to match your installed Ollama models.
make bench ARGS="--live --config bench/config.local.json"
```

`npm run bench -- ...` accepts the same arguments. Optional `--prompts FILE`
selects a larger JSON dataset; `--out DIRECTORY` selects a new output directory.
Existing directories are refused to prevent mixing mappings and labels.
The launcher uses installed Vite and a Node runtime matching better-sqlite3's
native ABI, including Electron's Node mode when needed. It does not rebuild
native modules, launch the app or install dependencies.

For cloud providers, set the agent's `provider`, a fixed `model`, and
`credentialEnv` to an environment-variable **name**. Export the actual key in
your shell. Supply the model's current `inputUsdPerMillion` and
`outputUsdPerMillion`. Agents sharing a provider share its credential/baseURL.
Keep keys out of configuration files. Local Ollama uses the server root URL
(for example `http://localhost:11434`); the adapter appends `/v1`.
Record local model digests in the optional `modelRevision` field; prefer pinned
cloud model versions. Pricing and model configuration are recorded with results.

Each run has a configurable cancellation timeout. Completed runs are checkpointed
in `progress.json`. Baseline/Phase-A order alternates per prompt. Results and local
configuration are gitignored. The bundled 20 prompts cover reasoning, coding,
data, design and output constraints, evenly split into calibration and held-out
items. They are a smoke test, not a calibration corpus. Freeze a larger held-out
set before tuning prompts or choosing thresholds.

## Outputs and human labeling

- `results.json`: mode, configuration, revision, messages, stable issues,
  per-phase provider calls (including failed attempts), estimated input/output,
  elapsed time, rounds, termination reason, synthesis and the private ID mapping.
- `report.md`: mode/category comparisons, p50/p95 wall time, rounds, call counts,
  token/cost totals, termination outcomes and the held-out quality gate.
- `benchmark-bundle.cjs`: the exact compiled runner used for the measurement,
  with its SHA-256 in results and the report, including for dirty working trees.
- `blind-items.json`: randomized IDs, question, reference, rubric and synthesis.
  No mode, model, round count, stop reason or private mapping is included.
- `stop-review-items.json`: the same IDs with final participant positions and
  stop reason, for evaluating premature stops **after** scoring answer quality.
- `labels-template.json`: fill `qualityScore` and `falseStop` for every ID.
  Null placeholders are rejected; unlabeled runs never silently receive scores.

Give the quality reviewer only `blind-items.json`, the label template and this
rubric, keeping `results.json` private. Score independently, then freeze quality
scores before reviewing stop outcomes. Use these anchors on the 0–4 scale:

| Score | Meaning |
| --- | --- |
| 4 | Correct, complete for the question, and follows all explicit constraints |
| 3 | Useful and substantially correct, with a minor omission or imprecision |
| 2 | Partially correct, with a material omission or error |
| 1 | Mostly incorrect or substantially violates the requested output |
| 0 | Missing synthesis, unusable, or wholly incorrect |

Set `falseStop=true` for a premature agreement claim, or an avoidable early stop
that leaves a material, correctable defect unresolved. Persistent disagreement
alone is not a false stop when it is reported honestly and the final answer
addresses the uncertainty; reaching the round cap alone is not a false stop.
Judge against the task's reference/rubric and final positions. Do not infer
correctness from unanimity. Keep failed/cancelled runs in the sample; a missing
synthesis scores zero.

```sh
make bench ARGS="--report bench/results/YOUR_RUN --labels /path/to/labels.json"
```

The report validates label IDs, deduplicates labels, and pairs modes by distinct
held-out prompt, averaging repeated scores within each prompt. The one-sided
95% lower bound of a paired prompt bootstrap must meet the configured
non-inferiority margin. The one-sided 95% Wilson upper bound of Phase A's
false-stop rate must meet its configured maximum; any failed repetition counts
as a failed prompt. All held-out runs must be labeled and the configured minimum
distinct sample size met. Defaults (100 held-out prompts, a 0.25-point margin,
5% maximum false stops) are evaluation choices, not validated Jev thresholds.

Fixture runs always remain `PENDING`, regardless of labels. Live smoke runs can
measure behavior and performance but also remain `PENDING` until the sample and
human-label requirements are met. Costs are character-based token estimates
multiplied by explicit model prices; local power/hardware cost and provider
billing reconciliation are excluded.

## Baseline scope

`scripts/bench/baseline/prompts.ts` is frozen from `7fe4439`. The adapter also
retains its old stopping behavior (including failed moderation treated as
convergence), generic rounds, and lack of `UNCHANGED` semantics. Both modes share
the extracted headless runner and corrected measurement code, so the comparison
is a behavioral baseline rather than a replay of the original Electron binary.
Web/repository/MCP context is disabled in this comparison; dedicated mocked
pipeline tests verify tool evidence and per-iteration accounting.
