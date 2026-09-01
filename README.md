# PiDevHouse

PiDevHouse turns a product request into a working project through a small team
of local AI agents. A product owner creates implementation stories, then
developer, reviewer, and tester agents complete and validate each story.

## Status

The core is runnable from the command line and exposes an optional local API.
It emits a typed, JSON-serializable event stream through an in-process event
bus. The terminal renderer consumes those events while the workflow remains
separate from presentation.

## Requirements

- [Bun](https://bun.sh/) (the provided Nix shell includes it)
- [Ollama](https://ollama.com/) running locally
- An Ollama model suitable for coding tasks
- Browser QA needs [agent-browser](https://github.com/vercel-labs/agent-browser), Chromium, and Python 3

With Nix and direnv installed, entering the repository loads the development
shell and `.env` automatically. Otherwise, export the environment variables
before running commands.

## Setup

```sh
cp .env.example .env
ollama pull qwen3.5:9b
```

Set `OLLAMA_MODEL` in `.env`. `OLLAMA_HOST` defaults to
`http://localhost:11434` when it is not set.

### Ollama server tuning

Flash attention and KV cache quantization are set on the Ollama **server
process**, not per model. There is no Modelfile line or API field for them,
only environment variables read once at `ollama serve` startup, so applying
them requires a full server restart. `jupyter_scripts/install_ollama.sh` and
`jupyter_scripts/setup_shell.sh` provision a remote Ollama host with these
already set (`OLLAMA_FLASH_ATTENTION=true`, `OLLAMA_KV_CACHE_TYPE=q8_0`,
`OLLAMA_CONTEXT_LENGTH=65536`); `setup_shell.sh` also installs them into the
host's `~/.bashrc` so they persist across restarts.

This roughly doubles usable context at the same VRAM budget (observed on a
~14.5 GB usable-VRAM host: context ceilings went from 18432/32768 to
32768/65536 depending on the model) with flat to slightly better decode
speed. See `docs/model-tuning.md` for per-model context ceilings and tuning
notes, `docs/todo.md` for pending comparisons.

## Run

Run the complete workflow directly in the terminal:

```sh
bun run core "Build an interactive web todo app"
```

Start only the API service by omitting the request:

```sh
bun run core
```

Only `PIDEV_PORT` configures the API port (default 8765); all other knobs are
flags:

| Flag | Default | Meaning |
|---|---|---|
| `--max-iterations=N` | `4` | Iteration budget per story |
| `--min-score=N` | `75` | Minimum review/test score to pass |
| `--no-reviewer` | off | Skip the reviewer agent |
| `--no-tester` | off | Skip the tester agent |
| `--timeout-minutes=N` | `20` | Per-agent-invocation timeout in minutes (`0` = none) |
| `--max-run-minutes=N` | `120` | Ceiling on the whole run (`0` = none). Bounds what `max-iterations` x agents x `timeout-minutes` can reach per story, so one stuck run cannot eat an unattended batch |

Each run creates artifacts under `output/<request>/<timestamp>/`:

- `src/` is the generated workspace, including `stories.json`.
- `log/outputlog.jsonl` records structured agent activity.
- `test/` contains tester artifacts, including browser screenshots.
- `summary.json` records outcome, request, model, config, durations, token
  tallies, and per-story scores and statuses.

## Experiments

```sh
bun run experiment [spec.json]
bun run experiment packages/core/scripts/experiment-template.json
bun run experiment packages/core/scripts/failure-containment-experiment.json
```

`experiment` runs the CLI once per variant and repeat. Without a spec file it
runs the default request three times. A spec looks like:

```json
{
  "repeat": 3,
  "variants": [
    { "request": "Build an interactive web todo app", "flags": {} },
    { "request": "Build an interactive web todo app", "flags": { "no-reviewer": true } }
  ]
}
```

Each batch is placed in the next available `output/experiments-N/` directory.
Pass `--output-subdir=name` when a batch needs a specific name.

### Batch sequences

A comparison usually needs several batches under different models, so
`packages/core/scripts/run-comparison.sh` runs them back to back. Each batch
pins its own model, context window and thinking level, and only one model is
resident at a time.

```sh
setsid nohup script -qec "bash packages/core/scripts/run-comparison.sh" /dev/null >/dev/null 2>&1 &
tail -f output/run-comparison.log
```

The TUI renderer needs a pty, hence `script`. Before each batch a preflight
loads the model and checks it came up at the expected `num_ctx` and fully
resident in VRAM, and skips the batch otherwise, because a batch that spilled
to CPU or loaded at the wrong context is not comparable with the others. Every
run records its model, context window, thinking level and commit in its own
`summary.json`. Edit the `batch` lines at the bottom of the script to change
what a sequence covers.

Do not start a second sequence against the same Ollama host while one is
running. The models here are sized so that one fits the GPU, so a second
sequence evicts the first one's model mid-run.

## Development

```sh
bun run dev
bun run check
bun run test
```

`dev` starts the core API in watch mode. `check` and `test` run the core checks.

## Repository Layout

```text
packages/core  Agent workflow and service API
docs/          Architecture map, model tuning notes, todo
output/        Generated run artifacts (ignored by Git)
```

`docs/architecture.md` is the pipeline map: the six stages, every knob that
steers them, which artifact records what, and the known gaps. Read it before
proposing a change to the workflow or debugging a run from its logs.

## License

[MIT](LICENSE)
