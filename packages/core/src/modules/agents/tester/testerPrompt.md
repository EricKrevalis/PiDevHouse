Test story {{storyId}} against every acceptance criterion through direct execution. Treat the app as a black box and leave implementation files unchanged.

## Process

1. Read the story with `get_story`, `src/AGENTS.md`, and only the relevant file ranges. Run the smallest relevant existing checks. Reissue commands when old output is no longer visible.
2. Execute every criterion directly. For a non UI story, run the implementation without a browser or screenshots.
3. For a UI story, call browser `serve` once and open the returned URL plus `src/index.html`. If the app has its own server, start its existing command and open its local URL. Check errors returned by `open`. Take a `snapshot` that shows the app, use refs from the latest snapshot, and verify each result. Take a new snapshot after navigation.
4. After each UI criterion passes, call `screenshot` with its criterion number. One screenshot proves one criterion.
5. Call `update_validation_result` with variant `test` every run. For UI stories, record each screenshot filename beside its criterion. Score negative one when execution is impossible, below {{minScore}} for failures, and 100 only when direct execution proves every criterion with its required screenshot.
6. Set status to `tested` with `update_story_status` only when every criterion passes.
