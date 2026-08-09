import type {
  Agent,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_TOOL_CALLS = 25;
const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const PROTECTED_FILE = "stories.json";

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

async function isScopedPath(root: string, input: string): Promise<boolean> {
  const target = resolve(root, input);
  if (!isInside(root, target)) return false;

  let existingPath = target;
  while (isInside(root, existingPath)) {
    try {
      const canonicalPath = resolve(
        await Deno.realPath(existingPath),
        relative(existingPath, target),
      );
      return isInside(await Deno.realPath(root), canonicalPath);
    } catch {
      if (existingPath === root) return false;
      existingPath = dirname(existingPath);
    }
  }

  return false;
}

export function scopeToolCalls(
  agent: Pick<Agent, "beforeToolCall">,
  root: string,
): void {
  const originalHook = agent.beforeToolCall;
  let toolCallCount = 0;

  agent.beforeToolCall = async (
    ctx: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    if (++toolCallCount > MAX_TOOL_CALLS) {
      return {
        block: true,
        reason: `Tool-call limit reached. Do not call more tools; complete the task now with a final response using the work already done.`,
      };
    }

    if (PATH_TOOLS.has(ctx.toolCall.name)) {
      const args = ctx.args as Record<string, unknown>;
      const path = args.path ?? args.file_path;
      if (path && !(await isScopedPath(root, String(path)))) {
        return {
          block: true,
          reason: `Tool paths must stay inside ${root}`,
        };
      }
      if (
        path &&
        WRITE_TOOLS.has(ctx.toolCall.name) &&
        basename(String(path)) === PROTECTED_FILE
      ) {
        return {
          block: true,
          reason: `${PROTECTED_FILE} may only be changed with the write_stories tool`,
        };
      }
    }

    return originalHook?.(ctx, signal);
  };
}
