import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../model/workspace.model.ts";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export const sandboxCommand = (
  cwd: string,
  command: string,
  writableDir?: string,
  readOnlyPaths: readonly string[] = [],
) =>
  [
    "bwrap --unshare-all --share-net --die-with-parent",
    "--ro-bind /nix /nix",
    "--ro-bind /run/current-system /run/current-system",
    "--ro-bind /etc /etc",
    "--proc /proc --dev /dev --tmpfs /tmp",
    `${writableDir === cwd ? "--bind" : "--ro-bind"} ${quote(cwd)} ${quote(cwd)}`,
    ...(writableDir && writableDir !== cwd
      ? [`--bind ${quote(writableDir)} ${quote(writableDir)}`]
      : []),
    ...readOnlyPaths.map((path) => `--ro-bind ${quote(path)} ${quote(path)}`),
    `--chdir ${quote(cwd)}`,
    `--setenv HOME /tmp --setenv TMPDIR /tmp bash -lc ${quote(command)}`,
  ].join(" ");

export function createSandboxedBashTool(
  workspace: Workspace,
  writableDir: string | undefined,
  readOnlyPaths: readonly string[],
) {
  return createBashToolDefinition(workspace.workspaceDir, {
    spawnHook: (context) => ({
      ...context,
      command: sandboxCommand(
        workspace.workspaceDir,
        context.command,
        writableDir,
        readOnlyPaths,
      ),
    }),
  });
}
