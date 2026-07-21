# PiDevHouse Plan

## Goal

Build a Linux-first desktop app that runs a Pi agent team against a selected
local project. The Product Owner defines the work, and every story gets its own
Developer, Reviewer, and Tester sessions.

## Current State

The implemented product is a Deno CLI in `packages/core`:

- A request creates a timestamped workspace under `output/`.
- Ollama configuration comes from `OLLAMA_HOST` and `OLLAMA_MODEL`.
- The Product Owner inspects the workspace and writes ordered stories to
  `stories.json`.
- Each story runs through fresh Developer, Reviewer, and Tester sessions before
  the next story starts.
- Agents coordinate through story statuses, review notes, test notes, and
  dependency IDs in `stories.json`.
- Agent text, tool activity, and raw Pi events are streamed or logged.
- Path-based tools are confined to the generated workspace and limited to 25
  calls per session.
- Shell commands run in a Linux Bubblewrap sandbox with only the generated
  workspace writable.

The repository also contains:

- `packages/desktop`: a SvelteKit, Tailwind CSS, and shadcn-svelte scaffold.
- Turborepo tasks for development, builds, checks, and core tests.
- Core tests for tool limits, Bubblewrap isolation, story parsing, and per-story
  role assignment.

Not implemented yet:

- Running against an operator-selected existing project.
- A desktop backend or native shell.
- Workflow APIs, normalized UI events, cancellation, or concurrent-run control.
- Desktop workflow controls, progress views, or packaged releases.
- Automatic rework when review or testing fails.

## Current Architecture

```text
CLI request
└── packages/core
    ├── Pi SDK
    ├── Ollama
    ├── generated output/<timestamp>/src workspace
    ├── stories.json
    └── Product Owner
        └── for each story
            ├── Developer
            ├── Reviewer
            └── Tester

packages/desktop
└── SvelteKit web UI scaffold
```

## Story Workflow

One request runs as follows:

1. Product Owner inspects the workspace and creates an ordered set of
   implementation-ready stories.
2. The orchestrator reads and validates the story IDs from `stories.json`.
3. For each story ID, in Product Owner order, the orchestrator starts a fresh
   Developer session for that exact story.
4. A fresh Reviewer session reviews that same story after it reaches `done`.
5. A fresh Tester session verifies that same story after it reaches `reviewed`.
6. The next story starts only after all three roles have run for the current
   story.

Dependencies must reference earlier stories. The Developer only starts
implementation when every `blockedBy` story is `tested`. Reviewer and Tester
stop without changing implementation when the expected prior status is absent.

Story status progression:

```text
todo → in_progress → done → reviewed → tested
```

Role responsibilities:

| Role          | Responsibility                                                    | Write access                                         |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| Product Owner | Create ordered stories, acceptance criteria, and dependencies     | Story file                                           |
| Developer     | Implement one explicit story and run focused checks               | Implementation, tests, and story status              |
| Reviewer      | Review one explicit completed story and record findings           | Review metadata and story status only by instruction |
| Tester        | Add the smallest necessary tests, run checks, and record evidence | Tests, test metadata, and story status               |

Each role uses a fresh Pi session. The generated workspace and `stories.json`
are the only continuity between sessions. Failed reviews and tests are recorded
but do not currently trigger automatic rework.

## Target Architecture

```text
Desktop shell
├── SvelteKit UI
├── local workflow backend
└── packages/core → Pi SDK → Ollama → selected project
```

The core should eventually expose one UI-independent workflow interface:

```ts
const result = await runWorkflow({
  projectRoot,
  request,
  ollama: { host, model },
  signal,
  onEvent,
});
```

The core owns session creation, per-story orchestration, role prompts, tool
configuration, path containment, event normalization, cancellation, and cleanup.
It must not depend on SvelteKit or desktop transport details.

## Roadmap

### 1. Stabilize the Core

- Extract orchestration from `main.ts` into `runWorkflow` while retaining the
  CLI.
- Accept an explicit project root instead of always creating an empty workspace.
- Validate story structure, dependencies, and status transitions before
  launching each role.
- Emit a small typed event set instead of exposing raw Pi events to consumers.
- Add cancellation and always dispose the active session.
- Add one integration test proving multiple stories each receive Developer,
  Reviewer, and Tester sessions in order.

### 2. Add the Local Backend

- Keep one in-memory active run with its status, current story, current role,
  events, and `AbortController`.
- Add start, event-stream, and cancel endpoints.
- Validate and canonicalize the selected project directory.
- Reject a second run while one is active.
- Replay retained events when the UI reconnects.

### 3. Build the Desktop UI

- Add project path, Ollama host, model, and request inputs.
- Add Run and Cancel controls.
- Display the current story, role, status, response text, and tool activity.
- Show completed, cancelled, and failed outcomes.
- Preserve keyboard access, visible focus, and a responsive layout.
- Reuse the installed shadcn-svelte components only where they reduce code.

### 4. Package and Verify

- Select and validate the native desktop runtime before coupling the core to it.
- Package a Linux release that does not require Node or Bun at runtime.
- Verify a multi-story workflow against a disposable project.
- Verify path and symlink containment, cancellation, failure reporting, and
  cleanup.
- Run the complete workflow from the packaged application.

## Acceptance Criteria

The first desktop release is complete when:

- The operator can select a project, configure Ollama, and submit a request.
- The Product Owner creates stories and every story runs through its own
  Developer, Reviewer, and Tester sessions in order.
- Each downstream role is bound to the same explicit story ID.
- Story dependencies and status gates prevent blocked work from being
  implemented.
- Text and tool activity stream to the UI with the current story and role.
- Only one workflow runs at a time and cancellation stops its active session.
- Project path traversal and symlink escapes are rejected.
- Completed, cancelled, review-failed, test-failed, and operational failure
  states are clear.
- The workflow remains runnable through the CLI.
- The packaged Linux application runs without Node or Bun installed.

## Deferred Work

- Concurrent workflows or multiple selected projects.
- Automatic Reviewer-to-Developer or Tester-to-Developer rework loops.
- Durable recovery after process or application crashes.
- Databases, remote synchronization, and multi-user collaboration.
- Provider switching and credential storage.
- Native directory picker workarounds.
- Auto-update and non-Linux packaging.

Add these only after the selected-project, per-story workflow is reliable.
