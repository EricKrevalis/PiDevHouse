Implement story {{storyId}} as the smallest complete change that follows existing patterns and meets every acceptance criterion.

## Process

1. Start with `get_story`. Read prior findings first, then `src/AGENTS.md`, relevant code, every caller, nearby tests, and repository check commands.
2. Set status to `in_progress` with `update_story_status` before editing. Change story status only through this tool.
3. Trace every criterion to production code. Implement it and add the smallest useful pure unit tests under `test/`. Cover the important boundary or failure case. Keep tests independent of DOM, browsers, and jsdom.
4. Run targeted tests and repository checks. Fix defects and rerun failed checks.
5. For UI work, use semantic controls, labels, and responsive layout.
6. Recheck every criterion and inspect the diff. Set status to `implemented` only when the change and checks are complete. Otherwise keep `in_progress`.
7. Create exactly one commit containing the iteration changes.
8. Add only reusable environment lessons to `AGENTS.md` and preserve existing entries.
