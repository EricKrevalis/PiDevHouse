# PiDevHouse

PiDevHouse turns a product request into a working project through a small team
of local AI agents. A product owner creates implementation stories, then
developer, reviewer, and tester agents complete and validate each story.

## Status

The core is currently runnable from the command line. The desktop package is a
SvelteKit frontend wrapped in a Tauri window, connected to the core over WebSocket.

The core emits a typed, JSON-serializable event stream (the `Message` model in
`packages/core/src/modules/model/message.model.ts`) on an in-process event bus.
Two views consume it: the terminal renderer (`TerminalView`, in-process) and
the WebSocket forwarder (the SvelteKit frontend). Events and UI are decoupled —
the core workflow only publishes messages and never renders terminal text.
Every message carries a run id; clients subscribe to a run over WebSocket (with
buffered replay on connect) and can fetch run state from `GET /runs/:runId`.

The intended architecture is one core service with two clients:

- The SvelteKit frontend creates runs and displays their progress and output.
- The CLI creates and follows the same runs for terminal-based use.

The workflow must live in the core, not in either client. The service should
create a run from a request, expose its status, stories, logs, and generated
workspace, and stream progress to connected clients. The CLI should remain a
thin client of that API rather than a second implementation of the workflow.

## Requirements

- [Bun](https://bun.sh/) and [Rust](https://www.rust-lang.org/) (the provided Nix shell includes them)
- [Ollama](https://ollama.com/) running locally
- An Ollama model suitable for coding tasks
- Browser QA needs [agent-browser](https://github.com/vercel-labs/agent-browser), Chromium, and Python 3. The Nix shell installs all three; outside Nix, run `npm install -g agent-browser && agent-browser install`.

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

## Run the flow directly

```sh
bun run core "Build an interactive web todo app"
```

This runs the complete core workflow directly in the terminal. It does not
start the API or development server.

To start only the API service for the desktop app, omit the request:

```sh
bun run core
```

### Flags

Only `PIDEV_PORT` configures the HTTP server port (default 8765); all other
knobs are flags:

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
- `test/` contains tester artifacts, including browser screenshots, and is bound into its sandbox.
- `summary.json` records outcome, request, model, config, durations,
  per-agent call and token tallies (when the model provider reports usage),
  and per-story scores, trajectories, and statuses on every termination path.

## Aggregate runs

```sh
bun run report                     # Markdown tables for all runs
bun run report --csv=output/summary.csv
bun run failures                   # Failed, incomplete, timed-out, and missing-summary runs
```

```sh
bun run experiment [spec.json]     # variant matrix × ≥3 runs
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

Each `experiment` batch is placed in the next available
`output/experiments-N/` directory. Pass `--output-subdir=name` only to
`experiment` when a batch needs a specific name; `report` and `failures` scan
all batches automatically.

For the paper's failure-modes and robustness experiment, use the prepared
matrix:

```sh
bun run experiment notes/failure-modes-experiment.json
bun run report
bun run report --csv=output/failure-modes-summary.csv
```

The matrix compares the baseline, reviewer ablation, one-iteration recovery
budget, and a five-minute per-agent timeout. Retain every run, including
`incomplete`, `timeout`, and `error` outcomes; classify them from `summary.json`,
`src/stories.json`, and `log/outputlog.jsonl` before making claims in the paper.

## Development

Run these commands from the repository root:

```sh
bun run dev
bun run check
bun run test
bun run build
bun run desktop:dev
```

`dev` starts the API service and the Vite development server, watching both.
`desktop:dev` opens the Tauri development window.
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
