import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_TOOL_CALLS = 25;
const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

function isInside(root: string, target: string) {
  const path = relative(root, target);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

async function isScopedPath(root: string, input: string) {
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
  agent: {
    beforeToolCall?: (ctx: any, signal: any) => any;
  },
  root: string,
) {
  const originalHook = agent.beforeToolCall;
  let toolCallCount = 0;

  agent.beforeToolCall = async (ctx, signal) => {
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
    }

    return originalHook?.(ctx, signal);
  };
}
