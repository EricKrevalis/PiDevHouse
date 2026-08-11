import assert from "node:assert/strict";
import { it } from "vitest";

import { Config } from "../config.model.ts";

it("trims the request and applies defaults", () => {
  const config = Config.from({ request: "  ship it  " });

  assert.equal(config.request, "ship it");
  assert.equal(config.minScore, 75);
  assert.equal(config.concurrency, 1);
});

it("derives the terminal status from enabled gates", () => {
  assert.equal(Config.from({ testerEnabled: true }).terminalStatus, "tested");
  assert.equal(
    Config.from({ reviewerEnabled: true, testerEnabled: false }).terminalStatus,
    "approved",
  );
  assert.equal(
    Config.from({ reviewerEnabled: false, testerEnabled: false }).terminalStatus,
    "implemented",
  );
});
