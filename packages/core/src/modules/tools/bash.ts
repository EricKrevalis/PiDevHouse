import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
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
  const trimmed = segment.trim();
  if (trimmed.startsWith("#")) return "true";
  const rest = trimmed
    .replace(/^\(+\s*/, "")
    .replace(/^\w+=(?:\$\(\([^)]*\)\)|[^\s$]+)\s*/, "");
  if (rest === "") return "true";
  return rest.match(/^([\w-]+)/)?.[1] ?? null;
}

// neutralize shell control characters (;|>) that live inside a quoted string so
// the segment splitter never treats quoted content as a separate command or a
// redirection. a single regex alternation cannot handle mixed nesting (a " inside
// a '...' region, or vice versa), so scan the string tracking which quote type is
// currently open and only close on the matching quote char. characters outside all
// quotes are left untouched, so genuinely unquoted >, ;, | still split and reject.
function maskQuotedRegions(command: string): string {
  const chars = [...command];
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else if (ch === ";" || ch === "|" || ch === ">") chars[i] = " ";
    } else if (inDouble) {
      if (ch === '"') inDouble = false;
      else if (ch === ";" || ch === "|" || ch === ">") chars[i] = " ";
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    }
  }
  return chars.join("");
}

function splitSegments(command: string): string[] {
  const masked = maskQuotedRegions(command);
  return masked.split(/\s*&&\s*|\s*\|\|\s*|;|\||\s+&(?=\s|$)/).filter(Boolean);
}

const ABSOLUTE_PATH_PATTERN = /(?<![\w./-])(?:\/[\w.-]+)+\/?/g;

// a `..` traversal component sitting on a path-segment boundary
const RELATIVE_TRAVERSAL_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/;

export function isInsideRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

// pull the relative path out of a token if it carries an upward `..` traversal,
// else null. handles a leading `flag=` prefix; leaves absolute paths to the
// absolute-path check above.
function relativeTraversalPath(token: string): string | null {
  const path = token.includes("=")
    ? token.slice(token.lastIndexOf("=") + 1)
    : token;
  if (path === "" || path.startsWith("/")) return null;
  if (!/^[\w./-]+$/.test(path)) return null;
  if (!RELATIVE_TRAVERSAL_SEGMENT.test(path)) return null;
  return path;
}

function findForeignPath(
  command: string,
  allowedRoots: readonly string[],
  baseDir?: string,
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
  // relative `../` traversals never match the absolute pattern; resolve them
  // against the assumed cwd (best-effort, same static limitation as above) and
  // reject any that land outside every allowed root.
  if (baseDir !== undefined) {
    for (const token of withoutQuoted.split(/\s+/)) {
      const candidate = relativeTraversalPath(token);
      if (candidate === null) continue;
      const resolved = resolve(baseDir, candidate);
      if (!allowedRoots.some((root) => isInsideRoot(root, resolved))) {
        return candidate;
      }
    }
  }
  return null;
}

export function validateBashCommand(
  command: string,
  allowedRoots: readonly string[],
  baseDir?: string,
): string | null {
  const foreignPath = findForeignPath(command, allowedRoots, baseDir);
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
    if (name === null) {
      return `Command rejected: could not identify a command in "${segment}", check for stray punctuation or unbalanced quotes/braces.`;
    }
    if (DENIED_COMMANDS.has(name)) {
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

// the roots bash is confined to. the run root (parent of src/ + test/ + log/)
// lets the tester reference its own test dir and run node tests from the run dir
// without a foreign-path reject. only this run's own tree is opened; sibling runs
// live under the parent slug dir.
export function sandboxAllowedRoots(workspace: Workspace): string[] {
  return [
    workspace.workspaceDir,
    workspace.testDir,
    dirname(workspace.workspaceDir),
    "/tmp",
    "/dev/null",
  ];
}

// the "## Sandbox" prompt section, derived from the live roots and DENIED_COMMANDS
// so the agents are never told a rule that no longer matches the validator.
export function describeSandbox(workspace: Workspace): string {
  const roots = sandboxAllowedRoots(workspace).join(", ");
  const denied = [...DENIED_COMMANDS].sort().join(", ");
  return `## Sandbox
bash is sandboxed. Absolute paths must stay within ${roots} (e.g. /nix/store is rejected). No command substitution ($(...) or backticks), no > redirection except to /dev/null or 2>&1, no nested shells (bash/sh/zsh -c/-lc). Always denied: ${denied}.
The check tokenizes the command as shell, so code embedded in a node -e or agent-browser eval flag trips it: backticks and $(...) are always rejected, and => arrows or nested quotes can read as redirection. Run a saved test file (node <file>) or agent-browser's own subcommands instead of embedding a script. chromium and agent-browser are on PATH; call them by name rather than probing bin dirs like /usr/bin or /nix/store, which are outside the sandbox.`;
}

export function createSandboxedBashTool(workspace: Workspace) {
  const allowedRoots = sandboxAllowedRoots(workspace);
  return createBashToolDefinition(workspace.workspaceDir, {
    spawnHook: (context) => {
      const denied = validateBashCommand(
        context.command,
        allowedRoots,
        workspace.workspaceDir,
      );
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