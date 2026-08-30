# todo

Last updated 2026-08-30.

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

## Next model comparisons

- think vs instruct sampling parameters, head to head per model family
  (q3kxl not yet measured, see `docs/model-tuning.md`)
- q3kxl family not yet run through either comparison above

## Open questions

- confirm with Kilian why `install_ollama.sh`'s kv cache and context length
  were downgraded to q4_0/32768 before this pass reverted them to q8_0/65536
- the tester agent getting stuck mid debug and burning its reasoning budget
  without ever writing a test result (seen across most incomplete runs
  above) is a real weak spot worth a fix on its own, separate from picking
  the right thinking level
