import { constants, accessSync, realpathSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  createBashToolDefinition,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";
import { isInside } from "./scope";

const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;
/** Default per-command timeout; the model may pass longer via the tool's timeout argument. */
const DEFAULT_TIMEOUT_SECONDS = 300;
const RUNTIME_PATHS = [
  "/nix/store",
  "/usr",
  "/bin",
  "/lib",
  "/lib64",
  "/run/current-system/sw",
  "/etc/ssl",
  "/etc/pki",
  "/etc/fonts",
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/resolv.conf",
];

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
      timeout ??= DEFAULT_TIMEOUT_SECONDS;
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
  // a custom tool named "bash" overrides pi's builtin in the tool registry
  return { ...tool, name: "bash", label: "Bash", executionMode: "sequential" };
}
