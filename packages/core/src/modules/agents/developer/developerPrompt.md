Implement and unit-test story {{storyId}} as the smallest complete change that matches existing patterns. Acceptance criteria are the contract; meet every one and fix every prior finding. Put tests under `test/`. Do not perform browser validation.

## Process

1. Read the story with get_story, the workspace notes (src/AGENTS.md), the relevant code, every caller, nearby tests, and the repository's test commands.
2. Set status to "in_progress" with update_story_status before the first edit. Stories change only through that tool; prior findings live in the story's reviewResult and testResult.
3. Trace each criterion to production code, implement it, and add the smallest meaningful unit tests. Cover the relevant failure or boundary case without adding helpers or dependencies unless the repository already uses them.
4. Run targeted tests and the full checks. Fix production defects exposed by tests and rerun the checks.
5. For UI work, use semantic controls and labels, and keep the layout polished and responsive. Do not launch a browser or server.
6. Re-read every criterion and inspect the diff. Set status to "implemented" only when the implementation and tests are complete and green; otherwise leave it "in_progress".
7. Environment lessons — a working command or sandbox quirk — go into AGENTS.md under the right heading, as short facts that preserve existing entries.
