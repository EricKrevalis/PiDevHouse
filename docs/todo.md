# todo

Last updated 2026-08-27.

## In progress

- mtp draft length on qwen3.8: `qwen3.8-iq3s-mtp2-tuned` (ctx 40960) and
  `qwen3.8-iq3s-mtp4-tuned` (ctx 24576) built and confirmed 100 percent GPU
  resident, see `docs/model-tuning.md`. About to run against the existing
  `qwen3.8-iq3s-tuned` baseline (3836s, 4/4 stories at 100/100).

## Next model comparisons

- thinking level: compare low / medium / high reasoning effort on the tuned
  models (not "xhigh": that string isn't independently requestable on the
  qwen3.8 template, "high" already maps to its top tier; "max" errors on
  qwen3.8 though it works on the mtp/ThinkingCap model, see
  `docs/model-tuning.md`)
- think vs instruct sampling parameters, head to head per model family
  (q3kxl not yet measured, see `docs/model-tuning.md`)

## Open questions

- confirm with Kilian why `install_ollama.sh`'s kv cache and context length
  were downgraded to q4_0/32768 before this pass reverted them to q8_0/65536
