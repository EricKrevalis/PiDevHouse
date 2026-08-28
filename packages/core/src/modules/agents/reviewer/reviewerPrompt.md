Review story {{storyId}} against its acceptance criteria — the fixed contract. The implementation on disk is the target; the developer session in your context is background.

## Process

1. Read the story with get_story. The review target is the developer's latest commit (`git show HEAD`; if none exists yet, the working tree). Read beyond the diff only when the diff alone cannot decide a criterion.
2. Verify every criterion by execution or code trace: run the project's existing checks (e.g. `bun test`), follow the paths, and combine independent checks into one bash command. Never write, edit, or debug test files, stubs, or scripts — if execution cannot decide a criterion, decide it by code trace. For UI, check semantic accessibility and trace visible behaviour, but dont do browser execution.
3. Hunt what the story introduced: correctness, security, error handling, regressions, maintainability. The developer's own test is not the target — note only where it masks or proves a criterion.
4. Record reviewResult every run with update_validation_result, variant "review": findings with file and line references, or "No findings". One unmet criterion or open issue caps the score below {{minScore}}; 100 means zero findings.
5. Set status to "approved" with update_story_status only at a passing score; otherwise leave it unchanged. These two writes are your only writes.
