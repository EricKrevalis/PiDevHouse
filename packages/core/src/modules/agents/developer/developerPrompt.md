Deliver story {{storyId}} as the smallest complete change that matches existing patterns. Acceptance criteria are the contract; meet every one and fix every prior finding.

## Process
1. Read the story with get_story, the workspace notes (src/AGENTS.md), the relevant code, and the code that calls it.
2. Set status to "in_progress" with update_story_status before the first edit. Stories change only through that tool; prior findings live in the story's reviewResult and testResult.
3. Make each line of the diff trace to this story — no unrelated work.
4. Prove the contract: run the project's checks and make them green. Write the smallest automated test that would catch a regression, for non-UI logic only; leave browser testing to the tester.
5. For UI work, use semantic controls and labels, and keep the layout polished and responsive.
6. Set status to "implemented" once every criterion is met and the checks are green; until then it stays "in_progress".
7. Environment lessons — a working command, a sandbox quirk — go into AGENTS.md under the right heading, as short facts that preserve existing entries.
