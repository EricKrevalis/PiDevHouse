import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxedBashTool } from "../../src/modules/tools/bash";

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.PIDEV_SANDBOX_SECRET;
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "pidev-sandbox-"));
  cleanup.push(root);
  const src = join(root, "src");
  const testRoot = join(root, "test");
  await Promise.all([mkdir(src), mkdir(testRoot)]);
  return { root, roots: [src, testRoot] };
}

const sandboxTest = Bun.which("bwrap") ? test : test.skip;

sandboxTest("bubblewrap writes src and cannot read host home or environment", async () => {
  const { root } = await createWorkspace();
  const secret = join(homedir(), `.pidev-sandbox-secret-${process.pid}`);
  cleanup.push(secret);
  await writeFile(secret, "host secret");
  process.env.PIDEV_SANDBOX_SECRET = "environment secret";

  const tool = createSandboxedBashTool(root);
  expect(tool.name).toBe("bash");
  await tool.execute(
    "write",
    {
      command:
        "printf sandboxed > src/allowed.txt && test -z \"${PIDEV_SANDBOX_SECRET+x}\"",
    },
    undefined,
    undefined,
    {} as never,
  );
  expect(await readFile(join(root, "src", "allowed.txt"), "utf8")).toBe(
    "sandboxed",
  );
  await expect(
    tool.execute(
      "read-home",
      { command: `cat '${secret.replaceAll("'", "'\\''")}'` },
      undefined,
      undefined,
      {} as never,
    ),
  ).rejects.toThrow("Command exited with code");
  await expect(
    tool.execute(
      "write-sibling",
      { command: "mkdir log" },
      undefined,
      undefined,
      {} as never,
    ),
  ).rejects.toThrow("Command exited with code");
});

sandboxTest("workspace root is writable, log stays read-only", async () => {
  const { root } = await createWorkspace();
  const tool = createSandboxedBashTool(root);

  await tool.execute(
    "write-root",
    { command: "printf {} > package.json && touch .gitkeep" },
    undefined,
    undefined,
    {} as never,
  );
  expect(await readFile(join(root, "package.json"), "utf8")).toBe("{}");

  const log = join(root, "log");
  await mkdir(log, { recursive: true });
  await writeFile(join(log, "stories.json"), "[]");
  await expect(
    tool.execute(
      "write-log",
      { command: "touch log/other.json" },
      undefined,
      undefined,
      {} as never,
    ),
  ).rejects.toThrow("Command exited with code");
  expect(await readFile(join(log, "stories.json"), "utf8")).toBe("[]");
});

sandboxTest("read-only workspace freezes src but keeps AGENTS.md writable", async () => {
  const { root } = await createWorkspace();
  await writeFile(join(root, "src", "AGENTS.md"), "# notes\n");
  const tool = createSandboxedBashTool(root, true);

  await tool.execute(
    "append-lesson",
    { command: "printf -- '- lesson\\n' >> src/AGENTS.md" },
    undefined,
    undefined,
    {} as never,
  );
  expect(await readFile(join(root, "src", "AGENTS.md"), "utf8")).toContain(
    "- lesson",
  );

  await expect(
    tool.execute(
      "write-src",
      { command: "touch src/new.txt" },
      undefined,
      undefined,
      {} as never,
    ),
  ).rejects.toThrow("Command exited with code");
});

sandboxTest("bubblewrap honors timeout and AbortSignal", async () => {
  const { root } = await createWorkspace();
  const tool = createSandboxedBashTool(root);

  await expect(
    tool.execute(
      "timeout",
      { command: "sleep 5", timeout: 0.05 },
      undefined,
      undefined,
      {} as never,
    ),
  ).rejects.toThrow("timed out");

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  await expect(
    tool.execute(
      "abort",
      { command: "sleep 5" },
      controller.signal,
      undefined,
      {} as never,
    ),
  ).rejects.toThrow("aborted");
});
