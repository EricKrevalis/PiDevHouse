# PiDevHouse

A software house built on Pi, a self-built dev harness.

## Current State

The working product is a Deno CLI in `packages/core`. For each request it:

1. Creates a timestamped workspace under `output/`.
2. Runs a Product Owner agent to write ordered stories to `stories.json`.
3. Runs a fresh Developer, Reviewer, and Tester session for every story, in
   Product Owner order.
4. Streams agent text to stdout, tool activity to stderr, and raw Pi events to
   the run's `log/outputlog.jsonl`.

The SvelteKit package in `packages/desktop` is currently a web UI scaffold.
Desktop integration, selecting an existing project, cancellation, and packaging
are planned in [docs/plan.md](docs/plan.md), not implemented yet.

## Development

The repository uses Deno workspaces for dependency management and Turborepo for
task orchestration and caching across `@pidev/core` and `@pidev/desktop`.
Install dependencies once from the root:

```sh
deno install
```

Use the root tasks for normal development:

```sh
deno task dev      # interactive TUI: SvelteKit + core type watcher
deno task build    # production SvelteKit web build
deno task check    # core and desktop type checks
deno task test     # core tests
deno task core "Build a todo app"  # run the agent CLI
```

The CLI requires a running Ollama server and `OLLAMA_MODEL`; copy the values in
`.env.example` into your environment. Agent shell commands and the sandbox test
also require Linux with `bwrap` available. The Nix development shell provides
it.

## Jupyter Host Scripts

`jupyter_scripts/` bootstraps a non-Nix Linux Jupyter host:

| Script              | Purpose                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install_fzf.sh`    | Installs `fzf` under `~/.fzf`.                                                                                                                             |
| `install_ollama.sh` | Installs Ollama under `~/.local`, configures its model directory, and starts the server. Pass `--update` to reinstall it.                                  |
| `setup_shell.sh`    | Runs both installers, replaces `~/.bash_profile`, and updates the managed block in `~/.bashrc`.                                                            |
| `tailscale.sh`      | Installs and starts a userspace Tailscale daemon, registers hostname `jupyter`, restarts Ollama on all interfaces, and serves port `11434` to the tailnet. |

Run only the setup needed on the Jupyter host:

```sh
bash jupyter_scripts/setup_shell.sh
bash jupyter_scripts/tailscale.sh
```

The Tailscale script changes Ollama's bind address and tailnet exposure. Review
it before running it on a shared host.

Run shadcn-svelte from `packages/desktop` without its npm installer:

```sh
deno task shadcn add button --no-deps
```

If a component needs a dependency that is not already installed, add it with
`deno add -D --package-json <package>` from `packages/desktop`.

SvelteKit uses Vite. Turborepo runs through Deno and discovers packages from the
root `package.json` workspace. Turborepo does not officially recognize Deno's
lockfile yet, so `turbo.json` enables its documented best-effort package-manager
mode and includes `deno.lock` in every cache key. The npm declaration in
`package.json` is only a Turborepo compatibility shim; Deno remains responsible
for installs and the lockfile. Turbo prints a warning about the intentionally
absent `package-lock.json`, but task discovery and caching still work.

## License

MIT — see [LICENSE](LICENSE).
