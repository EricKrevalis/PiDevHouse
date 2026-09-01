import assert from "node:assert/strict";
import { it } from "vitest";

import { Config } from "../config.model.ts";

it("trims the request and applies defaults", () => {
  const config = Config.from({ request: "  ship it  " });

  assert.equal(config.request, "ship it");
  assert.equal(config.minScore, 75);
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

it("gives both entry points the same defaults", () => {
  // from() said 3 iterations and fromArgs() said 4, so every run started
  // through the HTTP API silently got one iteration fewer than the CLI.
  const cli = Config.fromArgs(["build a thing"]);
  const api = Config.from({ request: "build a thing" });

  assert.equal(api.maxIterations, cli.maxIterations);
  assert.equal(api.minScore, cli.minScore);
  assert.equal(api.timeoutMinutes, cli.timeoutMinutes);
  assert.equal(api.maxRunMinutes, cli.maxRunMinutes);
  assert.equal(cli.maxIterations, 4);
});
