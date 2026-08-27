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
| `--timeout-minutes=N` | `0` | Per-agent timeout in minutes (`0` = none) |

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
output/        Generated run artifacts (ignored by Git)
```

## License

[MIT](LICENSE)
