import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../model/workspace.model.ts";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

// ponytail: name-gating only - no filesystem, process, or network confinement
// (bwrap was dropped). A hostile agent can still write files via node/python3,
// redirects, or `kill -9` anything; add bwrap back when untrusted models run
// outside the dev environment.
const ALLOWED_COMMANDS = new Set([
  "pwd",
  "echo",
  "true",
  "which",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "find",
  "sleep",
  "kill",
  "pkill",
  "cd",
  "node",
  "python3",
  "curl",
  "chromium",
  "agent-browser",
]);

const ALLOWED_SUMMARY = [...ALLOWED_COMMANDS].join(", ");

function commandName(segment: string): string | null {
  // Skip one env prefix (PORT=9433 node ...) or arithmetic assignment
  // (P=$((RANDOM % 200 + 9200))); $() command substitution is not skipped.
  const rest = segment.trim().replace(/^\w+=(?:\$\(\([^)]*\)\)|[^\s$]+)\s*/, "");
  if (rest === "") return "true";
  return rest.match(/^([\w-]+)/)?.[1] ?? null;
}

function splitSegments(command: string): string[] {
  const masked = command.replace(
    /"[^"]*"|'[^']*'/g,
    (quoted) => quoted.replace(/[;|]/g, " "),
  );
  return masked.split(/\s*&&\s*|\s*\|\|\s*|;|\||\s+&(?=\s|$)/).filter(Boolean);
}

export function validateBashCommand(command: string): string | null {
  for (const segment of splitSegments(command)) {
    const name = commandName(segment);
    if (name === null || !ALLOWED_COMMANDS.has(name)) {
      return `Command rejected by the bash allowlist: "${segment}". Allowed commands: ${ALLOWED_SUMMARY}.`;
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
    "env",
    `AGENT_BROWSER_SCREENSHOT_DIR=${quote(workspace.testDir)}`,
    `AGENT_BROWSER_DOWNLOAD_PATH=${quote(workspace.testDir)}`,
    "AGENT_BROWSER_CONTENT_BOUNDARIES=true",
    "AGENT_BROWSER_MAX_OUTPUT=12000",
    "AGENT_BROWSER_ALLOWED_DOMAINS=localhost,127.0.0.1",
    command,
  ].join(" ");

export function createSandboxedBashTool(workspace: Workspace) {
  return createBashToolDefinition(workspace.workspaceDir, {
    spawnHook: (context) => {
      const denied = validateBashCommand(context.command);
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
