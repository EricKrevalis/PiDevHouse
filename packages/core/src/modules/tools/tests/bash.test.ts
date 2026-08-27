import assert from "node:assert/strict";
import { it } from "vitest";
import {
  describeSandbox,
  sandboxAllowedRoots,
  validateBashCommand,
  wrapBashCommand,
} from "../bash.ts";

const allowedRoots = ["/output/run/src", "/output/run/test", "/tmp", "/dev/null"];

const workspace = {
  logDir: "/output/run/log",
  workspaceDir: "/output/run/src",
  testDir: "/output/run/test",
};

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

it("describes the sandbox from the live roots and denylist", () => {
  const description = describeSandbox(workspace);
  // every allowed root is named so the prompt never omits one the tool permits.
  for (const root of sandboxAllowedRoots(workspace)) {
    assert.ok(description.includes(root), `missing root ${root}`);
  }
  // the run root (parent of src/) is included, not just src/test/tmp/dev-null.
  assert.ok(description.includes("/output/run,"));
  // the denylist text stays in step with the validator: a command the validator
  // rejects as denied must appear in the description, one it allows must not.
  assert.notEqual(validateBashCommand("shred x", allowedRoots), null);
  assert.ok(description.includes("shred"));
  // node is allowed, so it must not appear in the denied-commands listing
  // (guidance prose elsewhere in the block may still name it).
  const deniedListing = (description.split("Always denied:")[1] ?? "").split("\n")[0];
  assert.equal(validateBashCommand("node --version", allowedRoots), null);
  assert.ok(!deniedListing.includes("node"));
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
  assert.equal(validateBashCommand("# just a comment", allowedRoots), null);
  assert.equal(validateBashCommand("ls src # inline note", allowedRoots), null);
  assert.equal(validateBashCommand("(cd src && ls)", allowedRoots), null);
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

it("allows the run root (parent of src/test) while keeping siblings and system paths out", () => {
  // createSandboxedBashTool adds dirname(workspaceDir), the run root, as an allowed root.
  const rootedAllowedRoots = [
    "/output/run/src",
    "/output/run/test",
    "/output/run",
    "/tmp",
    "/dev/null",
  ];
  // cd into the run root and run a test that imports ../src is now allowed.
  assert.equal(
    validateBashCommand(
      "cd /output/run && node test/logic.test.js",
      rootedAllowedRoots,
    ),
    null,
  );
  assert.equal(
    validateBashCommand("cat /output/run/log/outputlog.jsonl", rootedAllowedRoots),
    null,
  );
  // a sibling run under the parent slug dir stays rejected.
  assert.notEqual(
    validateBashCommand(
      "cat /output/other-run/src/index.html",
      rootedAllowedRoots,
    ),
    null,
  );
  // system paths stay rejected.
  assert.notEqual(
    validateBashCommand("cat /etc/passwd", rootedAllowedRoots),
    null,
  );
});

it("rejects relative traversals that escape all allowed roots", () => {
  const baseDir = "/output/run/src";
  assert.notEqual(
    validateBashCommand("cat ../../../etc/passwd", allowedRoots, baseDir),
    null,
  );
  assert.notEqual(
    validateBashCommand(
      "cd ../other-run-dir && cat src/index.html",
      allowedRoots,
      baseDir,
    ),
    null,
  );
  assert.notEqual(
    validateBashCommand("cat ../shared/util.js", allowedRoots, baseDir),
    null,
  );
});

it("allows relative traversals that stay inside an allowed root", () => {
  const baseDir = "/output/run/src";
  // sub/../other-allowed-dir resolves back inside workspaceDir.
  assert.equal(
    validateBashCommand("cd sub/../other-allowed-dir", allowedRoots, baseDir),
    null,
  );
  assert.equal(
    validateBashCommand("cat src/../test.js", allowedRoots, baseDir),
    null,
  );
  // the test dir is reachable from the run root as a sibling of src.
  const rootedAllowedRoots = [
    "/output/run/src",
    "/output/run/test",
    "/output/run",
    "/tmp",
    "/dev/null",
  ];
  assert.equal(
    validateBashCommand("cat ../test/story-1.png", rootedAllowedRoots, baseDir),
    null,
  );
});

it("leaves plain relative paths without traversal unaffected", () => {
  const baseDir = "/output/run/src";
  assert.equal(
    validateBashCommand("cat src/index.html", allowedRoots, baseDir),
    null,
  );
  assert.equal(
    validateBashCommand("node ./test.js 2>&1", allowedRoots, baseDir),
    null,
  );
  assert.equal(validateBashCommand("ls -la src/", allowedRoots, baseDir), null);
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
  assert.notEqual(validateBashCommand("(rm -rf /tmp)", allowedRoots), null);
});

it("does not misread => arrows or nested quotes in an eval body as redirection", () => {
  // the motivating case: a single-quoted async arrow whose body contains double
  // quotes. the => arrow's > must stay masked as quoted content, not read as a
  // file redirection.
  assert.equal(
    validateBashCommand(
      `agent-browser --cdp 9345 eval '(async()=>{return document.getElementById("display").textContent})'`,
      allowedRoots,
    ),
    null,
  );
  // mixed nesting the other way: a double-quoted outer containing a single quote.
  assert.equal(
    validateBashCommand(
      `node -e "const s='a=>b'; console.log(s)"`,
      allowedRoots,
    ),
    null,
  );
});

it("still catches genuinely unquoted dangerous content after quote masking", () => {
  // an unquoted > outside any quotes is still a redirection reject, even with an
  // unrelated quoted string present.
  assert.notEqual(
    validateBashCommand(`echo "hello world" > out.txt`, allowedRoots),
    null,
  );
  // an unquoted backtick is still a command-substitution reject.
  assert.notEqual(
    validateBashCommand("echo `whoami`", allowedRoots),
    null,
  );
  // an unquoted $(...) is still a command-substitution reject.
  assert.notEqual(
    validateBashCommand("echo $(whoami)", allowedRoots),
    null,
  );
  // a real ; rm -rf / where rm sits OUTSIDE any quote is still rejected, even
  // though an unrelated quoted string appears earlier in the command.
  assert.notEqual(
    validateBashCommand(`echo "just a note"; rm -rf /`, allowedRoots),
    null,
  );
});

it("does not reject a denied command name that lives only inside a quoted string", () => {
  // "rm" appears only as quoted text, never as a command, must not be rejected
  // (the don't-weaken-it check).
  assert.equal(
    validateBashCommand(`echo "please don't rm anything"`, allowedRoots),
    null,
  );
  assert.equal(
    validateBashCommand(`echo 'sudo is scary'`, allowedRoots),
    null,
  );
});

it("gives an honest, denylist-free message for an unidentifiable segment", () => {
  // a stray brace segment has no parseable command name. its message must be
  // distinct from the denied-command message and must not dump the denylist.
  const strayMessage = validateBashCommand("}", allowedRoots);
  assert.notEqual(strayMessage, null);
  assert.ok(!(strayMessage ?? "").includes("Denied commands:"));
  const deniedMessage = validateBashCommand("rm -rf /", allowedRoots);
  assert.ok((deniedMessage ?? "").includes("Denied commands:"));
  assert.notEqual(strayMessage, deniedMessage);
});
