# todo

Last updated 2026-08-31.

## Done

- mtp draft length on qwen3.8: `qwen3.8-iq3s-mtp2-tuned` and
  `qwen3.8-iq3s-mtp4-tuned` run 2x each against the `qwen3.8-iq3s-tuned`
  baseline, 6 runs total. No draft wins: baseline and mtp2 both finished
  clean 2/2, baseline was fastest on average, mtp4 produced the one run
  that never finished. Skip the draft model for qwen3.8. See
  `docs/model-tuning.md`.
- thinking level: compared low / medium / high reasoning effort on
  `qwen3.6-mtp-tuned` and `qwen3.8-iq3s-tuned`, 2 runs each, 12 runs total.
  `low` is the setting to use: only level that finished clean on both
  models, also the fastest. `medium`/`high` add wall time and a real chance
  the run never finishes, no score gain to offset it. See
  `docs/model-tuning.md`.

## Done 2026-08-31: reliability and measurement pass

Eight changes, listed in `docs/model-tuning.md` under "Reliability and
measurement fixes". Came out of comparing against Kilian's `refactor/rebuild`
branch; the full comparison and the ranked list are in the handin folder at
`ki/research/kilian-rebuild-comparison-2026-08-31.md`.

The headline: the timeout path in `agent.model.ts` returned before the
verdict-write nudge, so a gate agent that hit the 20 minute budget could never
record a result. A gate ending at exactly 1200.0s appears in 4 of our 5
incomplete runs and 0 of 13 completed ones. That answers the open question
below about the tester getting stuck, which turns out not to be a reasoning
budget problem at all.

Also settled by measuring our own logs: time to first token is 5-14 percent of
model time here, not the 38 percent Kilian measured, and 84 percent of all
generated tokens across 51 runs are reasoning tokens. Prompt-prefix work is not
where the time is; reasoning is.

## Next model comparisons

- think vs instruct sampling parameters, head to head per model family
  (q3kxl not yet measured, see `docs/model-tuning.md`)
- q3kxl family not yet run through either comparison above

## Open questions

- confirm with Kilian why `install_ollama.sh`'s kv cache and context length
  were downgraded to q4_0/32768 before this pass reverted them to q8_0/65536
- ~~the tester agent getting stuck mid debug and burning its reasoning budget
  without ever writing a test result~~ answered 2026-08-31: it was the 20
  minute wall-clock budget plus a control-flow bug that skipped the nudge on
  exactly that path, not the reasoning budget. Fixed; needs a batch to confirm
  the fix holds.
- `OLLAMA_HOST` binding: Kilian's experiment-3 notes call the `0.0.0.0` bind a
  bug to fix in `tailscale.sh`, our notes say it is required or the tailnet
  cannot reach the server. One of the two descriptions of the node topology is
  wrong. Settle before either side edits the script.
