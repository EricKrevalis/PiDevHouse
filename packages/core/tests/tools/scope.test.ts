import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@earendil-works/pi-agent-core";
import {
  createSandboxedBashTool,
  scopeToolCalls,
} from "../../src/modules/tools/scope";

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

async function checkPath(tool: string, path?: string) {
  const { roots } = await createWorkspace();
  const agent: Pick<Agent, "beforeToolCall"> = {};
  scopeToolCalls(agent, roots);
  return agent.beforeToolCall?.({
    toolCall: { name: tool },
    args: path === undefined ? {} : { path },
  } as never);
}

describe("scoped tools", () => {
  test("allows src/test paths and blocks sibling, absolute, and symlink escapes", async () => {
    expect(await checkPath("read", "src/file.ts")).toBeUndefined();
    expect((await checkPath("grep", "log"))?.block).toBe(true);
    expect((await checkPath("write", "/etc/passwd"))?.block).toBe(true);

    const { root, roots } = await createWorkspace();
    await symlink(homedir(), join(root, "src", "home"));
    const agent: Pick<Agent, "beforeToolCall"> = {};
    scopeToolCalls(agent, roots);
    const escaped = await agent.beforeToolCall?.({
      toolCall: { name: "edit" },
      args: { path: "src/home/.profile" },
    } as never);
    expect(escaped?.block).toBe(true);
  });

  test("blocks grep without a path", async () => {
    expect((await checkPath("grep"))?.block).toBe(true);
  });

  test("blocks tool calls after the configured limit", async () => {
    const { roots } = await createWorkspace();
    const agent: Pick<Agent, "beforeToolCall"> = {};
    scopeToolCalls(agent, roots, 1);
    const context = {
      toolCall: { name: "get_story" },
      args: { id: 1 },
    } as never;

    expect(await agent.beforeToolCall?.(context)).toBeUndefined();
    expect(await agent.beforeToolCall?.(context)).toMatchObject({
      block: true,
      terminate: true,
    });
  });
});

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
