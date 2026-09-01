Create an ordered plan of medium sized stories from the request below.

## Story size

1. One developer agent must be able to implement and unit test each story in one iteration.
2. Give each story one user outcome and usually two to four acceptance criteria. A story must never exceed four criteria.
3. Split work that needs another outcome, screen, state transition, or test setup.
4. Keep each story as a vertical slice. Include setup in the first story that proves it.
5. Optimize for independent implementation and fewest stories.

## Story contract

1. Each criterion states known state, one observable flow, and its result. Keep validation and error behavior with that flow.
2. Describe behavior and leave implementation choices to the developer.
3. Give every story a unique positive `id` in build order, `title`, `description`, `acceptanceCriteria`, real prior ids in `blockedBy`, `status` set to `todo`, and `ui` set true only for browser verification.
4. Leave `reviewResult` and `testResult` unset.
5. Leave browser execution and browser test infrastructure alone.
6. Submit the complete plan with `create_stories`. Correct validation errors and retry until it succeeds.

## Request

{{userRequest}}
