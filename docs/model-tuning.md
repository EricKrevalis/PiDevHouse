# Model tuning

Last updated 2026-08-30.

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

MTP draft model on qwen3.8 does not pay off: no draft (baseline) is the
fastest of the three and, together with `draft_num_predict 2`, tied for most
reliable (both 2/2 clean); a deeper draft (`draft_num_predict 4`) is both
slower and the only one of the three with a run that never finished.
Attaching a draft model spends VRAM and wall time without a decoding speed
win here.

Thinking level, tested on `qwen3.6-mtp-tuned` and `qwen3.8-iq3s-tuned`: `low`
is the only level that finished clean on both models. `medium` and `high` get
slower and less reliable as the level goes up, and `high` failed to finish
either run on the 3.8 model. More reasoning did not produce a better result
here, only a slower and shakier one.

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

## MTP draft model on qwen3.8 (2026-08-27, done)

Tested whether attaching a real speculative-decoding draft model helps the
`qwen3.8` family the way MTP already does for the ThinkingCap model. Same
calculator app spec, 2 repeats per variant, `THINKING_LEVEL=medium` (the
default at the time). Reports under `output/mtp-baseline-run{1,2}`,
`output/mtp2-run{1,2}`, `output/mtp4-run{1,2}`.

| variant                  | run  | duration | outcome    | stories                     |
|--------------------------|------|----------|------------|------------------------------|
| baseline (no draft)      | 1    | 3651s    | completed  | 3/3 tested, 100/100          |
| baseline (no draft)      | 2    | 4747s    | completed  | 2/2 tested, 100/100          |
| mtp2 (draft_num_predict 2) | 1  | 5443s    | completed  | 2/2 tested, 100/100          |
| mtp2 (draft_num_predict 2) | 2  | 3735s    | completed  | 2/2 tested, 100/100          |
| mtp4 (draft_num_predict 4) | 1  | 4037s    | completed  | 2/2 tested, 100/100          |
| mtp4 (draft_num_predict 4) | 2  | 10904s   | incomplete | 2/3 tested 100/100, 1 blocked at 0 |

Baseline and mtp2 both finished clean 2/2; baseline was the fastest of the
three on average (4199s vs 4589s for mtp2). At `draft_num_predict 4`, mtp4
produced the one run in this batch that never finished (a story got stuck
at `blocked` after 4 iterations, reasoning tokens for that run were about
212k against 73k-155k for the other five). A deeper draft did not speed
anything up here and made mtp4 the least reliable of the three. Conclusion:
skip the draft model for `qwen3.8`, the speculative decoding is not earning back its
VRAM and wall-time cost. `qwen3.8-iq3s-mtp2-tuned` / `-mtp4-tuned` stay on
the node for reference but are not worth promoting into regular use.

## Thinking level sweep (2026-08-28, done)

Compared `off`/`minimal` excluded, `low`/`medium`/`high` reasoning effort on
`qwen3.6-mtp-tuned` (ctx 26624) and `qwen3.8-iq3s-tuned` (ctx 65536), 2
repeats per level, same calculator app spec. Reports under
`output/thinking-3.6-<level>-run{1,2}` and `output/thinking-3.8-<level>-run{1,2}`.

| model | level  | run | duration | outcome    |
|-------|--------|-----|----------|------------|
| 3.6   | low    | 1   | 2203s    | completed  |
| 3.6   | low    | 2   | 491s     | completed  |
| 3.6   | medium | 1   | 2786s    | completed  |
| 3.6   | medium | 2   | 2309s    | incomplete (blocked at score 70, 2 stories never started) |
| 3.6   | high   | 1   | 2650s    | completed  |
| 3.6   | high   | 2   | 3394s    | incomplete (blocked at score 0, 1 story never started) |
| 3.8   | low    | 1   | 5906s    | completed  |
| 3.8   | low    | 2   | 3742s    | completed  |
| 3.8   | medium | 1   | 4082s    | completed  |
| 3.8   | medium | 2   | 6739s    | completed  |
| 3.8   | high   | 1   | 8852s    | incomplete (blocked at score 0, 1 story never started) |
| 3.8   | high   | 2   | 10193s   | incomplete (blocked at score 0, 1 story never started) |

Completion rate by level: low 4/4, medium 3/4, high 1/4. Average duration on
the runs that did finish also goes up with the level (3.6: about 1347s at
low vs about 2718s at medium/high combined; 3.8: about 4824s at low vs about
5410s at medium; high never finished either run, so no average to compare).

Every incomplete run failed the same way: the tester agent got stuck in a
long back and forth debugging a real UI bug (in one case a genuine CSS
centering/overflow bug in the generated calculator layout), burned through
its reasoning budget, and the run was aborted mid turn before it ever wrote
a test result, leaving the story `blocked` and the remaining stories
untouched. The two `high` runs on `qwen3.8` had by far the highest reasoning
token counts in the whole sweep (about 252k and 299k, versus roughly
6k-136k across the other ten runs), which lines up with this: more reasoning effort
did not make the tester agent solve the UI bug faster, it just spent longer
circling it and ran out of budget more often.

Conclusion: `low` is the setting to use. It was the only level that finished
clean on both models, and it was also the fastest. `medium` (the prior
default) and `high` add wall time and a real chance the run never finishes,
without any corresponding gain in test scores (every story that did finish,
finished at 100/100 regardless of level).
