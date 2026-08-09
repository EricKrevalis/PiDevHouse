import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../model/workspace.model.ts";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export const sandboxCommand = (cwd: string, command: string, bindDirs: readonly string[]) =>
  [
    "bwrap --unshare-all --share-net --die-with-parent",
    "--ro-bind /nix /nix",
    "--ro-bind /run/current-system /run/current-system",
    "--ro-bind /etc /etc",
    "--proc /proc --dev /dev --tmpfs /tmp",
    ...bindDirs.map((dir) => `--bind ${quote(dir)} ${quote(dir)}`),
    `--bind ${quote(cwd)} ${quote(cwd)} --chdir ${quote(cwd)}`,
    `--setenv HOME /tmp --setenv TMPDIR /tmp bash -lc ${quote(command)}`,
  ].join(" ");

export function createSandboxedBashTool(workspace: Workspace) {
  const bindDirs = [workspace.testDir];
  return createBashToolDefinition(workspace.workspaceDir, {
    spawnHook: (context) => ({
      ...context,
      command: sandboxCommand(
        workspace.workspaceDir,
        context.command,
        bindDirs,
      ),
    }),
  });
}
