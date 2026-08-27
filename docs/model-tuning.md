# Model tuning

Last updated 2026-08-27.

Remote host: `jupyter-infwge957` (100.119.46.106), reached over tailscale.
`jupyter_scripts/` provisions it.

## Models

Three families, each with an instruct and a tuned (think profile) Modelfile
under `models/`:

- `qwen3.6-mtp-tuned`, ThinkingCap 27B MTP IQ3_M, draft_num_predict 2, ctx 26624
- `qwen3.8-iq3s-tuned` / `qwen3.8-iq3s-instruct`, Qwen3.8 27B UD-IQ3_S, ctx 65536 / 32768
- `qwen3.8-q3kxl-tuned` / `qwen3.8-q3kxl-instruct`, Qwen3.8 27B UD-Q3_K_XL, ctx 36864 / 16384

Tuned profiles use think sampling (temperature 1.0, top_p 0.95, presence_penalty
0.0). Instruct profiles use temperature 0.7, top_p 0.80, presence_penalty 1.5.

Two more exist on the node only, not in this repo's `models/` (kept as plain
files under `~/models/` on the node, not git-tracked, since they depend on a
manually downloaded draft weight file local to that machine):

- `qwen3.8-iq3s-mtp2-tuned`, same base/sampling as `qwen3.8-iq3s-tuned` plus
  the separate Qwen3.8 MTP draft model attached (`draft_num_predict 2`), ctx
  40960
- `qwen3.8-iq3s-mtp4-tuned`, same but `draft_num_predict 4`, ctx 24576

The draft weights (`MTP/mtp-Qwen3.8-27B-Q4_0.gguf` from the
`unsloth/Qwen3.8-27B-GGUF` Hugging Face repo) are a separate file from the
main quant, not fused in, unlike the ThinkingCap model above. Ollama's HF
puller can't fetch a file that lives in a repo subdirectory
(`ollama pull hf.co/unsloth/Qwen3.8-27B-GGUF:<any tag guess>` rejects it), so
the draft file was downloaded by hand and attached via a second `FROM` line
in the Modelfile, the same way `qwen3.6-mtp-tuned`'s Modelfile attaches its
vision projector. Attaching it costs real VRAM on top of the base model: at
`draft_num_predict 2` the ceiling drops from 65536 (no draft) to 40960; at
`draft_num_predict 4` it drops further to 24576, since a deeper speculative
lookahead needs proportionally more buffer space.

## Server tuning

Flash attention and kv cache quantization are server env vars, not per model.
Set in `jupyter_scripts/install_ollama.sh`, persisted across restarts by
`setup_shell.sh`'s bashrc block:

```
OLLAMA_FLASH_ATTENTION=true
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_CONTEXT_LENGTH=65536
```

`OLLAMA_HOST` must stay `0.0.0.0:11434`, not `127.0.0.1:11434`, or the tailnet
can't reach the server. Verify the running process actually has these vars
with `ps eww $(pgrep -f 'ollama serve') | tr ' ' '\n' | grep OLLAMA` after any
restart, a bashrc edit alone does nothing until `ollama serve` is relaunched.

## Context ceilings

Found by binary search against `/api/ps`: a model is fully GPU resident when
`size_vram` equals `size`, any gap means CPU spillover and slower decode.

- `qwen3.6-mtp-tuned`: 26624 (32768 left it at ~88 percent resident)
- `qwen3.8-iq3s-tuned`: 65536 (full residency)
- `qwen3.8-q3kxl-tuned`: 36864 (full residency)

The mtp model spills earlier than the other two because of its draft model
and vision projector sitting on top of the main weights, so it does not get
the same headroom from the server tuning above.

## Findings so far

Think vs instruct wall-clock, from existing experiment summaries: think
completed faster (about 65 min vs about 91 min per run) at similar tok/s and
completion rate. Only measured for the mtp/iq3s families so far, not q3kxl.

## Fixes

- `OllamaProvider` reads `OLLAMA_CONTEXT_WINDOW` / `OLLAMA_MAX_TOKENS` from
  env instead of a hardcoded 32768/16384, so the client's context tracking
  matches the model's real `num_ctx`. Mismatch here means compaction never
  fires and ollama silently truncates context.
- `experiment.ts` aggregates results across repeats: mean/stddev/min/max
  duration, tokens, calls, failure rate, tested ratio.
- `summaryCollector` tracks wall-clock duration and invocation count per
  agent.
- bash sandbox: quote-aware segment splitting (mixed `'`/`"` nesting no
  longer breaks the redirection check), relative path traversal rejection,
  run root added to allowed roots so tests can run from the run dir.
- `THINKING_LEVEL` env var (`off`/`minimal`/`low`/`medium`/`high`, default
  `medium`) added to `agent.model.ts`, previously hardcoded to `medium` for
  every run. All runs recorded before this fix used `medium`; the app always
  explicitly sends a `reasoning_effort` value, so the model's own template
  default (`xhigh`, seen only when no effort is specified at all) was never
  actually in play historically.

## In progress: MTP draft model on qwen3.8 (2026-08-27)

Testing whether attaching a real speculative-decoding draft model helps the
`qwen3.8` family the way MTP already does for the ThinkingCap model, using
`qwen3.8-iq3s-mtp2-tuned` and `qwen3.8-iq3s-mtp4-tuned` above. Baseline for
comparison: the existing `qwen3.8-iq3s-tuned` run from the tuned-comparison
batch (3836s, 4/4 stories at 100/100, see
`../../../projects/handins/ki/research/pidevhouse-runs-2026-08-27-tuned-comparison/`).
Not yet run.
