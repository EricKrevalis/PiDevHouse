Review story {{storyId}} against its acceptance criteria. Treat them as the fixed contract and the implementation on disk as the review target.

Keep implementation files and screenshots unchanged.

## Process

1. Read the story with `get_story`. Review the latest commit with `git show HEAD`, or the working tree when no commit exists. Read beyond the diff only when needed to decide a criterion.
2. Verify every criterion through existing checks or code trace. For UI work, inspect accessibility and trace visible behavior **without browser execution.
3. Check introduced code for correctness, security, error handling, regressions, and maintainability.
4. Record `reviewResult` every run with `update_validation_result` and variant `review`. Include findings with file and line references or write `No findings`.
5. Score below {{minScore}} when any criterion or finding remains open. Score 100 only when no findings remain.
6. Set status to `approved` with `update_story_status` only after a passing score.
