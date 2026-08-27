import { expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserCommand,
  browserSessionName,
  createBrowserTool,
  type BrowserParams,
} from "../../src/modules/tools/browser";

function argsFor(params: Partial<BrowserParams>): string[] {
  return browserCommand({ action: "snapshot", ...params } as BrowserParams);
}

test("maps actions to agent-browser argv", () => {
  expect(argsFor({ action: "open", url: "http://127.0.0.1:8000/" })).toEqual([
    "open",
    "http://127.0.0.1:8000/",
  ]);
  expect(argsFor({ action: "click", selector: "e12" })).toEqual(["click", "e12"]);
  expect(argsFor({ action: "fill", selector: "#name", value: "ada" })).toEqual([
    "fill",
    "#name",
    "ada",
  ]);
  expect(argsFor({ action: "eval", value: "location.href" })).toEqual([
    "eval",
    "location.href",
  ]);
  expect(argsFor({ action: "screenshot" })).toEqual(["screenshot", "--full"]);
  expect(browserCommand({ action: "snapshot" })).toEqual(["snapshot"]);
});

test("rejects incomplete params", () => {
  expect(() => argsFor({ action: "open" })).toThrow("url");
  expect(() => argsFor({ action: "fill", selector: "#a" })).toThrow("value");
});

test("session name is stable and path-specific", () => {
  expect(browserSessionName("/a/ws")).toBe(browserSessionName("/a/ws"));
  expect(browserSessionName("/a/ws")).not.toBe(browserSessionName("/b/ws"));
});

test("serve starts a reachable static server and dispose stops it", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-tool-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "index.html"), "<p>hi</p>");
  const { tool, dispose } = createBrowserTool(root, 1);
  const execute = tool.execute as unknown as (
    id: string,
    params: BrowserParams,
  ) => Promise<{ content: { text: string }[] }>;
  try {
    const served = await execute("t", { action: "serve" });
    const url = served.content[0]!.text.trim();
    expect(await (await fetch(url)).text()).toContain("hi");
    await dispose();
    await expect(fetch(url, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
  } finally {
    await dispose();
  }
});
