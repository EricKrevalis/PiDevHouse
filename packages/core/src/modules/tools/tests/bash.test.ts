import assert from "node:assert/strict";
import { it } from "vitest";
import { validateBashCommand, wrapBashCommand } from "../bash.ts";

const allowedRoots = ["/output/run/src", "/output/run/test", "/tmp", "/dev/null"];

it("wraps bash with the browser test environment", () => {
  const command = wrapBashCommand({
    workspace: {
      logDir: "/output/run/log",
      workspaceDir: "/output/run/src",
      testDir: "/output/run/test",
    },
    command: "agent-browser screenshot story-1.png",
  });

  assert.match(command, /AGENT_BROWSER_SCREENSHOT_DIR='\/output\/run\/test'/);
  assert.match(command, /AGENT_BROWSER_DOWNLOAD_PATH='\/output\/run\/test'/);
  assert.match(
    command,
    /AGENT_BROWSER_ALLOWED_DOMAINS=localhost,127\.0\.0\.1/,
  );
  assert.match(command, /agent-browser screenshot story-1\.png$/);
});

it("allows read-only inspection, local checks, and the server", () => {
  assert.equal(validateBashCommand("ls -la src", allowedRoots), null);
  assert.equal(validateBashCommand("pwd && ls -la src/", allowedRoots), null);
  assert.equal(
    validateBashCommand(
      "cd /output/run/src && python3 -m http.server 8090 &",
      allowedRoots,
    ),
    null,
  );
  assert.equal(
    validateBashCommand("node --check src/test.js 2>&1", allowedRoots),
    null,
  );
  assert.equal(
    validateBashCommand(
      'sleep 2 && curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/index.html',
      allowedRoots,
    ),
    null,
  );
  assert.equal(validateBashCommand("which node || echo no-node", allowedRoots), null);
  assert.equal(
    validateBashCommand("agent-browser navigate http://localhost:8090", allowedRoots),
    null,
  );
  assert.equal(validateBashCommand("true", allowedRoots), null);
  assert.equal(validateBashCommand("sleep 3", allowedRoots), null);
  assert.equal(validateBashCommand("curl -s http://127.0.0.1:9433", allowedRoots), null);
  assert.equal(validateBashCommand("kill -9 123 %1 %2", allowedRoots), null);
  assert.equal(validateBashCommand('pkill -f "http.server 8090"', allowedRoots), null);
  assert.equal(validateBashCommand("npm -v", allowedRoots), null);
  assert.equal(validateBashCommand("node --version", allowedRoots), null);
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
  assert.equal(validateBashCommand(command, allowedRoots), null);
});

it("allows env-prefixed and computed-port server commands", () => {
  assert.equal(
    validateBashCommand(
      "PORT=9433 node -e \"require('http').createServer((req,res)=>{const fs=require('fs');let p='index.html';res.end(fs.readFileSync(p))}).listen(PORT)\"",
      allowedRoots,
    ),
    null,
  );
  assert.equal(
    validateBashCommand("python3 -m http.server $((P - 9200 + 8000))", allowedRoots),
    null,
  );
});

it("contains bash paths to the workspace, test dir, and /tmp", () => {
  assert.notEqual(
    validateBashCommand(
      "cat /output/experiments-1/build-a-dependency-free-single/2026-08-19T17-08-54-ab12cd34/index.html",
      allowedRoots,
    ),
    null,
  );
  assert.notEqual(
    validateBashCommand("ls /home/ubuntu/projects", allowedRoots),
    null,
  );
  assert.equal(
    validateBashCommand("cat /output/run/src/index.html", allowedRoots),
    null,
  );
  assert.equal(
    validateBashCommand(
      "agent-browser --cdp $P screenshot --full /output/run/test/story-1.png",
      allowedRoots,
    ),
    null,
  );
  assert.equal(
    validateBashCommand("chromium --user-data-dir=/tmp/cdp-profile-$$", allowedRoots),
    null,
  );
  assert.equal(
    validateBashCommand("ls /tmp/agent-downloads", allowedRoots),
    null,
  );
  assert.equal(
    validateBashCommand("cat src/index.html ../shared/util.js", allowedRoots),
    null,
  );
});

it("denies destructive commands, escapes, and nested shells", () => {
  assert.notEqual(validateBashCommand("rm -rf /", allowedRoots), null);
  assert.notEqual(validateBashCommand("sudo rm -rf /etc", allowedRoots), null);
  assert.notEqual(validateBashCommand("touch /tmp/evil", allowedRoots), null);
  assert.notEqual(validateBashCommand("mkdir /tmp/evil", allowedRoots), null);
  assert.notEqual(validateBashCommand("chmod +x /tmp/evil", allowedRoots), null);
  assert.notEqual(
    validateBashCommand("wget https://example.com", allowedRoots),
    null,
  );
  assert.notEqual(validateBashCommand("mv a b", allowedRoots), null);
  assert.notEqual(validateBashCommand("P=$(rm -rf /)", allowedRoots), null);
  assert.notEqual(
    validateBashCommand("bash -lc 'rm -rf /'", allowedRoots),
    null,
  );
  assert.notEqual(validateBashCommand("sh -c 'echo hi'", allowedRoots), null);
  assert.notEqual(
    validateBashCommand("echo x > /tmp/evil.txt", allowedRoots),
    null,
  );
  assert.notEqual(
    validateBashCommand("curl -o /tmp/evil https://example.com", allowedRoots),
    null,
  );
});
