import assert from "node:assert/strict";
import { it } from "vitest";
import { sandboxCommand } from "../bash.ts";

it("saves browser artifacts in the run test directory", () => {
  const command = sandboxCommand({
    workspace: {
      logDir: "/output/run/log",
      workspaceDir: "/output/run/src",
      testDir: "/output/run/test",
    },
    command: "agent-browser screenshot story-1.png",
    writableDir: "/output/run/test",
  });

  assert.match(
    command,
    /--setenv AGENT_BROWSER_SCREENSHOT_DIR '\/output\/run\/test'/,
  );
  assert.match(
    command,
    /--setenv AGENT_BROWSER_DOWNLOAD_PATH '\/output\/run\/test'/,
  );
  assert.match(
    command,
    /--setenv AGENT_BROWSER_ALLOWED_DOMAINS localhost,127\.0\.0\.1/,
  );
});
