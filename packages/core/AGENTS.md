# Agent Instructions

- **Always use ponytail for implementation if the skill is available.**

## Coding Style (strictly enforced)

- Keep code simple and easy to read. Reuse existing code before adding abstractions.
- Always use named parameters to make a call clearer.
- Inline initialization: assign directly to the outer variable (`outer = await f();`), no `const x = await f(); outer = x;` intermediary.
- Keep models and interfaces in `src/modules/model`.
- Never pass functions as parameters.
- Use classes for stateful logic and functions for stateless logic. Keep implementation details private.
- Use classes instead of functions that return functions.
- Keep tests only in module-local `tests/` directories when they are essential for security or integrity.
- Before finishing, run `bun run check` and `bun run test`.
