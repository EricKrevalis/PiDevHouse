import { constants, accessSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type {
  Agent,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import {
  createBashToolDefinition,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";

const PATH_TOOLS = new Set(["read", "grep", "write", "edit"]);
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;
const RUNTIME_PATHS = [
  "/nix/store",
  "/usr",
  "/bin",
  "/lib",
  "/lib64",
  "/run/current-system/sw",
  "/etc/ssl",
  "/etc/pki",
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/resolv.conf",
];

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

async function isScopedPath(root: string, target: string): Promise<boolean> {
  let existingPath = target;
  while (isInside(root, existingPath)) {
    try {
      const canonicalPath = resolve(
        await realpath(existingPath),
        relative(existingPath, target),
      );
      return isInside(await realpath(root), canonicalPath);
    } catch {
      existingPath = dirname(existingPath);
    }
  }
  return false;
}

function safePathEntries(): string[] {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(
      (path) =>
        path === "/bin" ||
        path === "/usr/bin" ||
        path.startsWith("/nix/store/") ||
        path.startsWith("/run/current-system/sw/"),
    );
}

function findRuntimeExecutable(name: string): string | undefined {
  for (const directory of safePathEntries()) {
    const path = resolve(directory, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {}
  }
}

function bubblewrapArgs(
  workspace: string,
  roots: readonly { source: string; target: string }[],
  shell: string,
  command: string,
  safePath: string,
): string[] {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--share-net",
    "--cap-drop",
    "ALL",
    "--clearenv",
    "--setenv",
    "HOME",
    "/tmp/home",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "PATH",
    safePath,
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--tmpfs",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/tmp/home",
  ];
  for (const path of RUNTIME_PATHS) args.push("--ro-bind-try", path, path);
  args.push("--dir", workspace, "--tmpfs", workspace);
  for (const root of roots) {
    args.push("--dir", root.target, "--bind", root.source, root.target);
  }

  args.push(
    "--remount-ro",
    workspace,
    "--remount-ro",
    "/",
    "--chdir",
    workspace,
    "--",
    shell,
    "-c",
    command,
  );
  return args;
}

function sandboxedBashOperations(
  bwrap: string,
  workspace: string,
  roots: readonly { source: string; target: string }[],
  shell: string,
  safePath: string,
): BashOperations {
  return {
    exec(command, cwd, { onData, signal, timeout }) {
      if (resolve(cwd) !== workspace) {
        throw new Error(`Sandbox cwd must be ${workspace}`);
      }
      if (signal?.aborted) throw new Error("aborted");
      if (
        timeout !== undefined &&
        (!Number.isFinite(timeout) ||
          timeout <= 0 ||
          timeout > MAX_TIMEOUT_SECONDS)
      ) {
        throw new Error(
          `Invalid timeout: must be between 0 and ${MAX_TIMEOUT_SECONDS} seconds`,
        );
      }

      return new Promise((resolveExec, reject) => {
        const child = spawn(
          bwrap,
          bubblewrapArgs(workspace, roots, shell, command, safePath),
          {
            detached: true,
            env: {
              HOME: "/tmp/home",
              LANG: "C.UTF-8",
              PATH: safePath,
              TMPDIR: "/tmp",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stopped: "aborted" | "timeout" | undefined;
        const stop = (reason: "aborted" | "timeout") => {
          if (stopped) return;
          stopped = reason;
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        };
        const onAbort = () => stop("aborted");
        const timer =
          timeout === undefined
            ? undefined
            : setTimeout(() => stop("timeout"), timeout * 1000);
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        };

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
        child.once("error", (error) => {
          cleanup();
          reject(error);
        });
        child.once("close", (exitCode) => {
          cleanup();
          if (stopped === "aborted") reject(new Error("aborted"));
          else if (stopped === "timeout") reject(new Error(`timeout:${timeout}`));
          else resolveExec({ exitCode });
        });
      });
    },
  };
}

export function createSandboxedBashTool(
  workspacePath: string,
): ReturnType<typeof createBashToolDefinition> {
  if (process.platform !== "linux") {
    throw new Error("Sandboxed bash requires Linux and bubblewrap (bwrap)");
  }
  const bwrap = findRuntimeExecutable("bwrap");
  if (!bwrap) {
    throw new Error(
      "Sandboxed bash requires bubblewrap (bwrap), but it is not installed or not on PATH",
    );
  }
  const shell = findRuntimeExecutable("bash") ?? findRuntimeExecutable("sh");
  if (!shell) throw new Error("Sandboxed bash could not find a runtime shell");

  const workspace = realpathSync(resolve(workspacePath));
  const roots = ["src", "test"].map((name) => {
    const target = resolve(workspace, name);
    const source = realpathSync(target);
    if (!isInside(workspace, source)) {
      throw new Error(`Sandbox root must stay inside ${workspace}: ${target}`);
    }
    return { source, target };
  });
  const safePath = safePathEntries().join(delimiter) || "/usr/bin:/bin";
  const tool = createBashToolDefinition(workspace, {
    exposeSessionEnvironment: false,
    operations: sandboxedBashOperations(
      bwrap,
      workspace,
      roots,
      shell,
      safePath,
    ),
  });
  return { ...tool, executionMode: "sequential" };
}

export function scopeToolCalls(
  agent: Pick<Agent, "beforeToolCall">,
  roots: readonly string[],
  maxToolCalls = Infinity,
): void {
  const scopedRoots = roots.map((root) => resolve(root));
  const workspace = dirname(scopedRoots[0] ?? resolve("."));
  const originalBefore = agent.beforeToolCall;
  let toolCalls = 0;

  agent.beforeToolCall = async (
    ctx: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    if (++toolCalls > maxToolCalls) {
      return {
        block: true,
        reason: `Tool call limit (${maxToolCalls}) reached`,
        terminate: true,
      };
    }
    if (PATH_TOOLS.has(ctx.toolCall.name)) {
      const args = ctx.args as Record<string, unknown>;
      const path = args.path ?? args.file_path;
      const target = resolve(workspace, typeof path === "string" ? path : ".");
      const inside = (
        await Promise.all(scopedRoots.map((root) => isScopedPath(root, target)))
      ).some(Boolean);
      if (!inside) {
        return {
          block: true,
          reason: `Tool paths must stay inside ${roots.join(", ")}`,
        };
      }
    }

    return originalBefore?.(ctx, signal);
  };
}
