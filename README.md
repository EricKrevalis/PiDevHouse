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

Each run creates timestamped artifacts under `output/`:

- `src/` is the generated workspace, including `stories.json`.
- `log/outputlog.jsonl` records structured agent activity.
- `test/` is reserved for run-specific test output.

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
