# Prompt: Analyze the last experiment run

Analyze the latest experiment (`packages/core/runs/experiment-N/` — highest N) for **stability** and **speed** problems, using logs **and** source code. Follow the style of `docs/research/experiment-*-findings-*.md`.

1. **Logs**: parse each run's `log/log.jsonl` (no streaming deltas — final think/text messages per turn, plus tool calls, retries, errors, timeouts, path violations, truncation, compaction, story statuses) and `summary.json` (outcome, duration, tokens, stacks). Distinguish run-lost from turn-lost. For speed: TTFT vs generation vs tool time, tokens/context per agent, outliers.
2. **Code**: trace every cause to a concrete location in `packages/core/src/` (file:line) or label it model-level. Read the code a fix would touch before proposing it.
3. **Prior findings**: check the latest findings doc — which fixes/remaining items are closed by this run, which regress.
4. **Git history**: `git log` since the last findings doc — map each run behavior (improvement or regression) to the commit that introduced it.

## Output (concise)

- Run overview table (outcome, duration, tokens).
- Ends with exactly two tables, P0 first:

```markdown
## Prioritized: Stability

| Priority | Cause | Proposed fix |
| --- | --- | --- |

## Prioritized: Speedup

| Priority | Cause | Proposed fix |
| --- | --- | --- |
```

Priority: P0 = kills/forfeits runs or biggest wall-time lever, P2 = cosmetic. Cause: one line, evidence + code ref. Fix: minimal and concrete, or "leave as is" with reason. No prose beyond one short interpretation paragraph.
