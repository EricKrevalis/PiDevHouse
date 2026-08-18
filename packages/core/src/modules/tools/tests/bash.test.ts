import assert from "node:assert/strict";
import { it } from "vitest";
import { validateBashCommand, wrapBashCommand } from "../bash.ts";

it("wraps bash with the browser test environment", () => {
  const command = wrapBashCommand({
    workspace: {
      logDir: "/output/run/log",
      workspaceDir: "/output/run/src",
      testDir: "/output/run/test",
    },
    command: "agent-browser screenshot story-1.png",
  });

  assert.match(command, /^env /);
  assert.match(command, /AGENT_BROWSER_SCREENSHOT_DIR='\/output\/run\/test'/);
  assert.match(command, /AGENT_BROWSER_DOWNLOAD_PATH='\/output\/run\/test'/);
  assert.match(
    command,
    /AGENT_BROWSER_ALLOWED_DOMAINS=localhost,127\.0\.0\.1/,
  );
});

it("allows read-only inspection, local checks, and the server", () => {
  assert.equal(validateBashCommand("ls -la src"), null);
  assert.equal(validateBashCommand("pwd && ls -la src/"), null);
  assert.equal(
    validateBashCommand("cd /w/src && python3 -m http.server 8090 &"),
    null,
  );
  assert.equal(validateBashCommand("node --check src/test.js 2>&1"), null);
  assert.equal(
    validateBashCommand(
      'sleep 2 && curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/index.html',
    ),
    null,
  );
  assert.equal(validateBashCommand("which node || echo no-node"), null);
  assert.equal(validateBashCommand("agent-browser navigate http://localhost:8090"), null);
  assert.equal(validateBashCommand("true"), null);
  assert.equal(validateBashCommand("sleep 3"), null);
  assert.equal(validateBashCommand("curl -s http://127.0.0.1:9433"), null);
  assert.equal(validateBashCommand("kill -9 123 %1 %2"), null);
  assert.equal(validateBashCommand('pkill -f "http.server 8090"'), null);
});

it("allows the one-call browser test flow with a CDP port", () => {
  const command = [
    "P=$((RANDOM % 200 + 9200))",
    "python3 -m http.server 8090 >/dev/null 2>&1 &",
    "chromium --headless=new --no-sandbox --disable-gpu --remote-debugging-port=$P --user-data-dir=/tmp/cdp-profile-$$ http://localhost:8090/ >/dev/null 2>&1 &",
    "sleep 3",
    "agent-browser --cdp $P open http://localhost:8090/",
    "agent-browser --cdp $P snapshot",
    "agent-browser --cdp $P click '@e1'",
    "agent-browser --cdp $P fill @e2 'Test Task'",
    "agent-browser --cdp $P screenshot --full /output/run/test/story-1.png",
    "kill %1 %2 2>/dev/null",
    "pkill -f remote-debugging-port 2>/dev/null",
    "pkill -f http.server 2>/dev/null",
  ].join("; ");
  assert.equal(validateBashCommand(command), null);
});

it("allows env-prefixed and computed-port server commands", () => {
  assert.equal(
    validateBashCommand(
      "PORT=9433 node -e \"require('http').createServer((req,res)=>{const fs=require('fs');let p='index.html';res.end(fs.readFileSync(p))}).listen(PORT)\"",
    ),
    null,
  );
  assert.equal(
    validateBashCommand("python3 -m http.server $((P - 9200 + 8000))"),
    null,
  );
});

it("denies non-allowlisted commands and command substitution", () => {
  assert.notEqual(validateBashCommand("rm -rf /"), null);
  assert.notEqual(validateBashCommand("sudo rm -rf /etc"), null);
  assert.notEqual(validateBashCommand("git push origin main"), null);
  assert.notEqual(validateBashCommand("npm install"), null);
  assert.notEqual(validateBashCommand("chmod +x /tmp/evil"), null);
  assert.notEqual(validateBashCommand("wget https://example.com"), null);
  assert.notEqual(validateBashCommand("P=$(rm -rf /)"), null);
  assert.notEqual(validateBashCommand("bash -lc 'rm -rf /'"), null);
});
