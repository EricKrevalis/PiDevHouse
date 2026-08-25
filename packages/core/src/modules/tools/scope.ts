import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  Agent,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";

const PATH_TOOLS = new Set(["read", "grep", "write", "edit"]);
const STORY_WRITE_TOOLS = new Set([
  "create_stories",
  "update_story_status",
  "update_validation_result",
]);

export function isInside(root: string, target: string): boolean {
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

export function scopeToolCalls(
  agent: Pick<Agent, "beforeToolCall" | "steer">,
  roots: readonly string[],
  maxToolCalls = Infinity,
): void {
  const scopedRoots = roots.map((root) => resolve(root));
  const workspace = dirname(scopedRoots[0] ?? resolve("."));
  const originalBefore = agent.beforeToolCall;
  let toolCalls = 0;
  let warned = false;

  agent.beforeToolCall = async (
    ctx: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    if (!STORY_WRITE_TOOLS.has(ctx.toolCall.name)) {
      if (++toolCalls > maxToolCalls) {
        return {
          block: true,
          reason: `Tool call limit (${maxToolCalls}) reached`,
          terminate: true,
        };
      }
      if (!warned && toolCalls === maxToolCalls - 1) {
        warned = true;
        agent.steer({
          role: "user",
          content: `Warning: one tool call remaining (limit ${maxToolCalls}).`,
          timestamp: Date.now(),
        });
      }
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
