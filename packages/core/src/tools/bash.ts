import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export const sandboxCommand = (cwd: string, command: string) =>
  [
    "bwrap --unshare-all --share-net --die-with-parent",
    "--ro-bind /nix /nix",
    "--ro-bind /run/current-system /run/current-system",
    "--ro-bind /etc /etc",
    "--proc /proc --dev /dev --tmpfs /tmp",
    `--bind ${quote(cwd)} ${quote(cwd)} --chdir ${quote(cwd)}`,
    `--setenv HOME /tmp --setenv TMPDIR /tmp bash -lc ${quote(command)}`,
  ].join(" ");

export function createSandboxedBashTool(cwd: string) {
  return createBashToolDefinition(cwd, {
    spawnHook: (context) => ({
      ...context,
      command: sandboxCommand(cwd, context.command),
    }),
  });
}
