import { realpath } from "node:fs/promises";
import type {
  Agent,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { STORIES_PATH, AGENTS_PATH, TOOLS } from "./registry.ts";

const PATH_TOOLS = new Set<string>([
  TOOLS.read,
  TOOLS.write,
  TOOLS.edit,
  TOOLS.grep,
  TOOLS.find,
  TOOLS.ls,
]);
const WRITE_TOOLS = new Set<string>([TOOLS.write, TOOLS.edit]);

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
        await realpath(existingPath),
        relative(existingPath, target),
      );
      return isInside(await realpath(root), canonicalPath);
    } catch {
      if (existingPath === root) return false;
      existingPath = dirname(existingPath);
    }
  }

  return false;
}

export type WriteAccess = "all" | "notes";

// the tools that record a verdict. the budget must never block these: a gate
// agent whose closing write is refused burns its iteration silently, and after
// maxIterations the story blocks with every dependent story untouched. this is
// the second path to a silent gate, next to the timeout one finalizeAfterTimeout
// covers, and it was the observed cause of a blocked story on 2026-08-31.
const VERDICT_TOOLS = new Set<string>([
  TOOLS.updateStoryFields,
  TOOLS.writeStories,
]);

// what the guard did with an agent's tool calls, read back for the summary.
// rejected calls are the wasted share of an agent's turn: refused for scope, for
// write access, or for the budget, never reaching the tool.
export interface ToolCallBudget {
  executed: number;
  rejected: number;
}

// a refusal still costs a model round trip, so an agent reissuing the same
// refused call can spin until its invocation timer fires. counting rejections
// against the executed budget used to bound that as a side effect; now that
// they are counted apart, the bound has to be its own rule. set above
// maxToolCalls so ordinary mistakes still leave room to recover.
const REJECTION_LIMIT_FACTOR = 2;

export function scopeToolCalls(
  agent: Pick<Agent, "beforeToolCall" | "afterToolCall">,
  roots: readonly string[],
  maxToolCalls: number,
  writeAccess: WriteAccess = "all",
): ToolCallBudget {
  const originalBefore = agent.beforeToolCall;
  const originalAfter = agent.afterToolCall;
  const budget: ToolCallBudget = { executed: 0, rejected: 0 };

  const reject = (reason: string): BeforeToolCallResult => {
    budget.rejected += 1;
    return { block: true, reason };
  };

  agent.beforeToolCall = async (
    ctx: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    // checked before the guards below, not after: a refusal loop is built out
    // of calls the guards themselves refuse, so a cap sitting behind them would
    // never be reached by the case it exists for. verdict tools stay exempt,
    // since a refused turn must still be able to record its result.
    if (
      !VERDICT_TOOLS.has(ctx.toolCall.name) &&
      budget.rejected >= maxToolCalls * REJECTION_LIMIT_FACTOR
    ) {
      return reject(
        `Too many refused tool calls (${budget.rejected}). Stop retrying; record your result now with ${TOOLS.updateStoryFields} using the work already done.`,
      );
    }

    if (PATH_TOOLS.has(ctx.toolCall.name)) {
      const args = ctx.args as Record<string, unknown>;
      const path = args.path ?? args.file_path;
      const inside = path
        ? (await Promise.all(
            roots.map((root) => isScopedPath(root, String(path))),
          )).some(Boolean)
        : true;
      if (!inside) {
        return reject(`Tool paths must stay inside ${roots.join(", ")}`);
      }
      if (
        path &&
        WRITE_TOOLS.has(ctx.toolCall.name) &&
        basename(String(path)) === STORIES_PATH
      ) {
        return reject(
          `${STORIES_PATH} may only be changed with the write_stories tool`,
        );
      }
      if (
        path &&
        writeAccess === "notes" &&
        WRITE_TOOLS.has(ctx.toolCall.name) &&
        basename(String(path)) !== AGENTS_PATH
      ) {
        return reject(
          `Writes are limited to ${AGENTS_PATH}; record environment lessons there`,
        );
      }
    }

    // counted after the guards above, so a call refused for scope does not eat
    // the allowance of a call that would have run. rejections are their own
    // number rather than a silent tax on the budget.
    if (
      !VERDICT_TOOLS.has(ctx.toolCall.name) &&
      budget.executed >= maxToolCalls
    ) {
      return reject(
        `Tool-call limit reached. Do not call more tools; record your result now with ${TOOLS.updateStoryFields} and give a final response using the work already done.`,
      );
    }

    // ask the downstream hook before counting: a call it blocks never ran, so
    // charging it to the executed budget would overstate the work done.
    const downstream = await originalBefore?.(ctx, signal);
    if (downstream?.block === true) {
      budget.rejected += 1;
      return downstream;
    }
    budget.executed += 1;
    return downstream;
  };

  agent.afterToolCall = async (
    ctx,
    signal,
  ): Promise<import("@earendil-works/pi-agent-core").AfterToolCallResult | undefined> => {
    const result = originalAfter?.(ctx, signal);
    if (ctx.toolCall.name === "read" || ctx.toolCall.name === "bash") {
      const text = (ctx.result as { content?: { text?: string }[] })?.content?.[0]?.text;
      if (typeof text === "string" && text.length > 4000) {
        return {
          content: [{ type: "text", text: `${text.slice(0, 4000)}\n… [truncated ${text.length - 4000} chars]` }],
        };
      }
    }
    return result;
  };

  return budget;
}
