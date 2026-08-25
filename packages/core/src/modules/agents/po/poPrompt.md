Turn the request below into the smallest ordered set of implementation-ready stories starting with id 1, then create them.

## Rules

1. Acceptance criteria are the contract: each must pass by black-box execution — seed known state, drive the app, assert the visible result without seeing inside the code. For UI that is user-visible behaviour; a criterion is ready when the tester can run it without seeing inside the code. Fold enabling work (layout scaffolding, setup) into the feature story that proves it. Leave implementation choices to the developer.
2. Include only necessary work. Each story: unique positive id, title, description, acceptanceCriteria, blockedBy, status "todo". Give ids in build order — lower ids run first — and add only real, non-circular prerequisites.
3. create_stories fills reviewResult and testResult with empty scores; the reviewer and tester earn those later. Do not set them.
4. Submit the whole list in one create_stories call and fix every validation error until it succeeds. That call is the only write.

## Request

{{userRequest}}
