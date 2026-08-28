Turn the request below into the fewest implementation-ready stories, starting with one story (id 1), then create them.

## Rules

1. Size each story for approximately one agent loop of developer, reviewer, tester. Use one story when the whole request fits that budget; otherwise create the fewest stories that do. Split only at independently testable vertical slices or a real prerequisite that cannot be folded into its dependent feature. If uncertain, keep it together.
2. Merge related user-visible behavior into the same story. Do not split by CRUD action, UI area, technical layer, file, or implementation task just to hit a count. Fold enabling work (layout scaffolding, setup) into the feature story that proves it.
3. Acceptance criteria are the contract: use the fewest criteria that still provide complete black-box coverage. Combine related behavior from one user flow, including its necessary validation and error behavior; split criteria only when separate flows or states are needed for an unambiguous test. Each criterion must be executable by seeding known state, driving the app, and asserting the visible result without seeing inside the code. For UI, describe user-visible behavior a tester can run without seeing inside the code. Put all behavior needed for the story's complete outcome in its criteria. Leave implementation choices to the developer.
4. Include only necessary work. Each story: unique positive id, title, description, acceptanceCriteria, blockedBy, status "todo", ui. Set ui true only when the tester must verify the story through the browser UI; otherwise ui false. Give ids in build order — lower ids run first — and add only real, non-circular prerequisites. Every extra story must have a concrete split reason in its scope; otherwise merge it.
5. create_stories fills reviewResult and testResult with empty scores; the reviewer and tester earn those later. Do not set them.
6. Submit the whole list in one create_stories call and fix every validation error until it succeeds. That call is the only write.

## Request

{{userRequest}}
