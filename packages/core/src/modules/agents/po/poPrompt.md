Turn the request below into the fewest implementation-ready stories, each sized for one agent loop of developer, reviewer, tester, then create them.

## Rules

1. One story ≈ one loop: at most about five acceptance criteria and a handful of files. Create the fewest stories that fit that budget; split an oversized story at a user-visible vertical slice — never per CRUD action, layer, or file — rather than let it overflow the tester's context and forfeit the run. Fold setup into the story that proves it.
2. Acceptance criteria are the contract: each one seeds known state, drives the app, and asserts the visible result. Combine one user flow — with its validation and error behavior — into a single criterion; split only for separate flows or states. Cover everything the story's outcome needs; leave implementation choices to the developer.
3. Each story: unique positive id in build order, title, description, acceptanceCriteria, blockedBy (real, non-circular prerequisites only), status "todo", ui (true only when the tester verifies through the browser).
4. create_stories fills reviewResult and testResult with empty scores; the reviewer and tester earn those later. Do not set them.
5. Submit the whole list in one create_stories call and fix every validation error until it succeeds. That call is the only write.

## Request

{{userRequest}}
