import assert from "node:assert/strict";
import { it } from "vitest";
import { trackPlateau } from "../storyRunner.ts";

it("blocks after two consecutive non-improving failing scores", () => {
  let state: { best: number; flat: number; plateau: boolean } = { best: -Infinity, flat: 0, plateau: false };
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, true);
});

it("resets when the failing score improves and passes never plateau", () => {
  let state: { best: number; flat: number; plateau: boolean } = { best: -Infinity, flat: 0, plateau: false };
  state = trackPlateau(60, 75, state);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(80, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, true);
});

it("treats unverifiable (-1) scores as failing and plateaus like any score", () => {
  let state: { best: number; flat: number; plateau: boolean } = { best: -Infinity, flat: 0, plateau: false };
  state = trackPlateau(-1, 75, state);
  state = trackPlateau(-1, 75, state);
  state = trackPlateau(-1, 75, state);
  assert.equal(state.plateau, true);
});
