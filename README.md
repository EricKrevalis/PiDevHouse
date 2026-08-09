# PiDevHouse

PiDevHouse turns a product request into a working project through a small team
of local AI agents. A product owner creates implementation stories, then
developer, reviewer, and tester agents complete and validate each story.

## Status

The core is currently runnable from the command line. The desktop package is a
SvelteKit UI scaffold and is not connected to the core yet.

The intended architecture is one core service with two clients:

- The SvelteKit frontend creates runs and displays their progress and output.
- The CLI creates and follows the same runs for terminal-based use.

The workflow must live in the core, not in either client. The service should
create a run from a request, expose its status, stories, logs, and generated
workspace, and stream progress to connected clients. The CLI should remain a
thin client of that API rather than a second implementation of the workflow.

## Requirements

- [Deno](https://deno.com/) (the provided Nix shell includes it)
- [Ollama](https://ollama.com/) running locally
- An Ollama model suitable for coding tasks

With Nix and direnv installed, entering the repository loads the development
shell and `.env` automatically. Otherwise, export the environment variables
before running commands.

## Setup

```sh
cp .env.example .env
ollama pull qwen3.5:9b
```

Set `OLLAMA_MODEL` in `.env` to the model you pulled. `OLLAMA_HOST` defaults to
`http://localhost:11434` when it is not set.

## Run the CLI

```sh
deno task core Build an interactive web todo app
```

The request is optional; without one, the core uses an interactive web todo app
as its default request.

### Flags

Every knob is also available as a `PIDEV_*` environment variable (for example
`PIDEV_MAX_ITERATIONS`):

| Flag | Default | Meaning |
|---|---|---|
| `--max-iterations=N` | `4` | Iteration budget per story |
| `--min-score=N` | `75` | Minimum review/test score to pass |
| `--no-reviewer` | off | Skip the reviewer agent |
| `--no-tester` | off | Skip the tester agent |
| `--timeout-minutes=N` | `0` | Per-agent timeout in minutes (`0` = none) |
| `--concurrency=N` | `1` | Run ready stories in parallel with bounded concurrency |
| `--orchestrator` | off | Replace the fixed loop with the LLM `OrchestratorAgent` |

Each run creates artifacts under `output/<request>/<timestamp>/`:

- `src/` is the generated workspace, including `stories.json`.
- `log/outputlog.jsonl` records structured agent activity.
- `test/` is the tester's persistent scratch directory, bound into its sandbox.
- `summary.json` (also copied as `run.json`) records outcome, exit code,
  request, model, config, durations, token totals per agent, and per-story
  scores, trajectories, and statuses on every termination path.

## Aggregate runs

```sh
deno task report                     # Markdown tables for all runs
deno task report --csv=output/summary.csv
```

```sh
deno task experiment [spec.json]     # variant matrix × ≥3 runs
```

`experiment` runs the CLI once per (variant, repeat) pair. Without a spec file
it runs the default request 3 times. A spec looks like:

```json
{
  "repeat": 3,
  "variants": [
    { "request": "Build an interactive web todo app", "flags": {} },
    { "request": "Build an interactive web todo app", "flags": { "no-reviewer": true } }
  ]
}
```

Each run lands in its own `output/<request>/<timestamp>/` directory; results
are aggregated into `output/experiment-<timestamp>.json`.

## Development

Run these commands from the repository root:

```sh
deno task dev
deno task check
deno task test
deno task build
```

`dev` starts the desktop development server and watches the core's types.
`check` validates both packages. `test` invokes the core test suite when test
modules are present. `build` builds the desktop application.

## Repository layout

```text
packages/core     Agent workflow and future service API
packages/desktop  SvelteKit frontend
output/           Generated run artifacts (ignored by Git)
```

## License

[MIT](LICENSE)
