import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, sep } from "node:path";
import type { Workspace } from "../model/workspace.model.ts";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

const DENIED_COMMANDS = new Set([
  "rm", "mv", "cp", "dd", "shred", "truncate", "touch", "mkdir", "rmdir",
  "ln", "tee", "install", "chmod", "chown", "chgrp", "wget", "sudo", "su",
  "doas", "mount", "umount", "mkfs", "fdisk", "parted", "passwd", "useradd",
  "usermod", "groupadd", "systemctl", "reboot", "shutdown", "poweroff",
  "killall",
]);

function commandName(segment: string): string | null {
  const rest = segment
    .trim()
    .replace(/^\w+=(?:\$\(\([^)]*\)\)|[^\s$]+)\s*/, "");
  if (rest === "") return "true";
  return rest.match(/^([\w-]+)/)?.[1] ?? null;
}

function splitSegments(command: string): string[] {
  const masked = command.replace(/"[^"]*"|'[^']*'/g, (quoted) =>
    quoted.replace(/[;|>]/g, " "),
  );
  return masked.split(/\s*&&\s*|\s*\|\|\s*|;|\||\s+&(?=\s|$)/).filter(Boolean);
}

const ABSOLUTE_PATH_PATTERN = /(?<![\w./-])(?:\/[\w.-]+)+\/?/g;

function isInsideRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

function findForeignPath(
  command: string,
  allowedRoots: readonly string[],
): string | null {
  const withoutHeredoc = command.split("<<")[0];
  const withoutUrls = withoutHeredoc.replace(/\w+:\/\/\S+/g, " ");
  const withoutQuoted = withoutUrls.replace(/"[^"]*"|'[^']*'/g, " ");
  for (const match of withoutQuoted.matchAll(ABSOLUTE_PATH_PATTERN)) {
    const path = match[0];
    if (!allowedRoots.some((root) => isInsideRoot(root, path))) {
      return path;
    }
  }
  return null;
}

export function validateBashCommand(
  command: string,
  allowedRoots: readonly string[],
): string | null {
  const foreignPath = findForeignPath(command, allowedRoots);
  if (foreignPath !== null) {
    return `Command rejected by the bash denylist: "${foreignPath}" is outside the allowed roots (${allowedRoots.join(", ")})`;
  }
  for (const segment of splitSegments(command)) {
    if (/\$\([^(]/.test(segment) || segment.includes("`")) {
      return `Command rejected by the bash denylist: command substitution is not allowed: "${segment}"`;
    }
    const name = commandName(segment);
    if (name === "bash" || name === "sh" || name === "zsh") {
      if (/\s(-lc|-c)\b/.test(segment)) {
        return `Command rejected by the bash denylist: nested shells are not allowed: "${segment}"`;
      }
    }
    if (
      segment.replace(/2>&1|>\s*\/dev\/null/g, "").includes(">") ||
      (name === "curl" &&
        /(?:^|\s)-(?:o|O)\s+(?!\/dev\/null\b)|(?:^|\s)--output\s+(?!\/dev\/null\b)/.test(
          segment,
        ))
    ) {
      return `Command rejected by the bash denylist: writing files with redirections is not allowed: "${segment}"`;
    }
    if (name === null || DENIED_COMMANDS.has(name)) {
      return `Command rejected by the bash denylist: "${segment}". Denied commands: ${[...DENIED_COMMANDS].sort().join(", ")}.`;
    }
  }
  return null;
}

export const wrapBashCommand = ({
  workspace,
  command,
}: {
  workspace: Workspace;
  command: string;
}) =>
  [
    `AGENT_BROWSER_SCREENSHOT_DIR=${quote(workspace.testDir)}`,
    `AGENT_BROWSER_DOWNLOAD_PATH=${quote(workspace.testDir)}`,
    "AGENT_BROWSER_CONTENT_BOUNDARIES=true",
    "AGENT_BROWSER_MAX_OUTPUT=12000",
    "AGENT_BROWSER_ALLOWED_DOMAINS=localhost,127.0.0.1",
    command,
  ].join(" ");

export function createSandboxedBashTool(workspace: Workspace) {
  const allowedRoots = [
    workspace.workspaceDir,
    workspace.testDir,
    "/tmp",
    "/dev/null",
  ];
  return createBashToolDefinition(workspace.workspaceDir, {
    spawnHook: (context) => {
      const denied = validateBashCommand(context.command, allowedRoots);
      if (denied !== null) {
        return { ...context, command: `echo ${quote(denied)}; exit 1` };
      }
      return {
        ...context,
        command: wrapBashCommand({ workspace, command: context.command }),
      };
    },
  });
}