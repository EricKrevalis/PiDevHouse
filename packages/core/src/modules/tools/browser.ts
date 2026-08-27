import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { basename, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

const MAX_RESULT_CHARS = 12_000;
const COMMAND_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 2_000;
const SERVER_TIMEOUT_MS = 10_000;

const paramsSchema = z.object({
  action: z
    .enum([
      "serve",
      "open",
      "snapshot",
      "click",
      "fill",
      "eval",
      "screenshot",
      "close",
    ])
    .describe(
      "serve: start a static server exposing the workspace root (src/ is at /src/) and return its URL. open: navigate. snapshot: accessibility tree with element refs. click/fill: act on a ref or CSS selector. eval: run JavaScript in the page. screenshot: save criterion evidence into test/. close: stop browser and server.",
    ),
  url: z.string().optional().describe("Target URL for open."),
  selector: z
    .string()
    .optional()
    .describe("Element ref from snapshot (e.g. e12) or CSS selector, for click/fill."),
  value: z
    .string()
    .optional()
    .describe("Text for fill or JavaScript for eval."),
  criterion: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Acceptance-criterion number for screenshot."),
});

export type BrowserParams = z.infer<typeof paramsSchema>;

export function browserCommand(params: BrowserParams): string[] {
  const { action, url, selector, value } = params;
  switch (action) {
    case "open":
      if (!url) throw new Error("open requires url");
      return ["open", url];
    case "click":
      if (!selector) throw new Error("click requires selector");
      return ["click", selector];
    case "fill":
      if (!selector || value === undefined) throw new Error("fill requires selector and value");
      return ["fill", selector, value];
    case "eval":
      if (value === undefined) throw new Error("eval requires value");
      return ["eval", value];
    case "screenshot":
      return ["screenshot", "--full", ...(value ? [value] : [])];
    case "snapshot":
      return ["snapshot"];
    default:
      throw new Error(`action ${action} is handled internally`);
  }
}

export function createBrowserTool(workspace: string, storyId: number): {
  tool: ToolDefinition;
  dispose: () => Promise<void>;
  capturedCriteria: ReadonlySet<number>;
} {
  const testDir = resolve(workspace, "test");
  mkdirSync(testDir, { recursive: true });
  let server: ChildProcess | undefined;
  let serverUrl: string | undefined;
  const capturedCriteria = new Set<number>();

  const env = () => ({
    ...process.env,
    AGENT_BROWSER_SESSION_NAME: browserSessionName(workspace),
    AGENT_BROWSER_ALLOWED_DOMAINS: "localhost,127.0.0.1",
    AGENT_BROWSER_CONTENT_BOUNDARIES: "true",
    AGENT_BROWSER_MAX_OUTPUT: String(MAX_RESULT_CHARS),
    AGENT_BROWSER_SCREENSHOT_DIR: testDir,
    AGENT_BROWSER_DOWNLOAD_PATH: testDir,
  });

  /** Run agent-browser in its own process group so timeouts/aborts kill the whole tree. */
  function run(args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
    return new Promise((resolveRun, rejectRun) => {
      const child = spawn("agent-browser", args, {
        cwd: workspace,
        env: env(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let output = "";
      let settled = false;
      const stop = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        rejectRun(error);
      };
      const timer = setTimeout(
        () => stop(new Error(`agent-browser timed out after ${timeoutMs / 1000}s`)),
        timeoutMs,
      );
      child.stdout.on("data", (chunk: Buffer) => {
        if (output.length < MAX_RESULT_CHARS) output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (output.length < MAX_RESULT_CHARS) output += chunk.toString();
      });
      child.once("error", (error) => stop(error));
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const text = output.trim().slice(0, MAX_RESULT_CHARS);
        if (code === 0) resolveRun(text);
        else rejectRun(new Error(text || `agent-browser ${args.join(" ")} failed`));
      });
    });
  }

  async function freePort(): Promise<number> {
    const listener = createServer();
    await new Promise<void>((resolveListen) => listener.listen(0, "127.0.0.1", resolveListen));
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>((close) => listener.close(() => close()));
    return port;
  }

  async function serve(): Promise<string> {
    if (serverUrl) return serverUrl;
    const port = await freePort();
    // Serve the workspace root so both /index.html and /src/... asset paths resolve.
    server = spawn(
      "python3",
      ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", workspace],
      { cwd: workspace, stdio: "ignore", detached: true },
    );
    let serverError: Error | undefined;
    server.once("error", (error) => (serverError = error));
    serverUrl = `http://127.0.0.1:${port}/`;
    const deadline = Date.now() + SERVER_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (serverError) throw serverError;
      if (server.exitCode !== null) {
        throw new Error(`static server exited with code ${server.exitCode}`);
      }
      try {
        await fetch(serverUrl, { signal: AbortSignal.timeout(1000) });
        return serverUrl;
      } catch {
        await Bun.sleep(200);
      }
    }
    killTree(server.pid);
    server = undefined;
    serverUrl = undefined;
    throw new Error(`static server did not start within ${SERVER_TIMEOUT_MS / 1000}s`);
  }

  function killTree(pid: number | undefined, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
    if (!pid) return;
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
  }

  /** Post-navigation evidence: page errors and failed requests in one round trip. */
  async function navigationEvidence(): Promise<string> {
    const [errors, failures] = await Promise.all([
      run(["network", "errors"]).catch(() => ""),
      run(["network", "requests", "--status", "400-599"]).catch(() => ""),
    ]);
    const parts = [];
    if (errors) parts.push(`Page errors:\n${errors}`);
    if (failures) parts.push(`Failed requests:\n${failures}`);
    return parts.join("\n");
  }

  async function dispose(): Promise<void> {
    serverUrl = undefined;
    if (server) {
      killTree(server.pid);
      server = undefined;
    }
    try {
      await run(["close"], CLOSE_TIMEOUT_MS);
    } catch {
      // daemon already gone
    }
  }

  const tool: ToolDefinition = {
    name: "browser",
    label: "Browser",
    description:
      "Drive a local headless browser to verify UI stories. State persists between calls; refs come from the last snapshot.",
    parameters: z.toJSONSchema(paramsSchema),
    async execute(_toolCallId: string, params: BrowserParams) {
      if (params.action === "serve") {
        return toolResult(await serve());
      }
      if (params.action === "close") {
        await dispose();
        return toolResult("browser and static server stopped");
      }
      const args = browserCommand(params);
      if (params.action === "screenshot") {
        if (!params.criterion) throw new Error("screenshot requires criterion");
        args.push(
          resolve(testDir, `story-${storyId}-ac-${params.criterion}.png`),
        );
        const result = await run(args);
        capturedCriteria.add(params.criterion);
        return toolResult(result);
      }
      const result = await run(args);
      if (params.action !== "open") return toolResult(result);
      const evidence = await navigationEvidence();
      return toolResult(evidence ? `${result}\n\n${evidence}` : result);
    },
  };

  return { tool, dispose, capturedCriteria };
}

export function browserSessionName(workspace: string): string {
  const hash = createHash("sha256").update(resolve(workspace)).digest("hex").slice(0, 8);
  return `pidev-${basename(workspace)}-${hash}`;
}

function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
