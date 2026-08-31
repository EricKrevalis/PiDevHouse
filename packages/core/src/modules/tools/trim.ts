import type { Agent } from "@earendil-works/pi-agent-core";

/** Matches the browser tool's output cap so no tool result dominates the context. */
const MAX_RESULT_CHARS = 12_000;

function trimText(text: string, maxChars: number): string {
  const head = Math.floor((maxChars * 2) / 3);
  const tail = maxChars - head;
  const trimmed = text.length - head - tail;
  return `${text.slice(0, head)}\n[... ${trimmed} characters trimmed ...]\n${text.slice(-tail)}`;
}

export function trimToolOutputs(
  agent: Pick<Agent, "afterToolCall">,
  maxChars = MAX_RESULT_CHARS,
): void {
  const originalAfter = agent.afterToolCall;
  agent.afterToolCall = async (context, signal) => {
    const original = await originalAfter?.(context, signal);
    let changed = false;
    const content = context.result.content.map((block) => {
      if (block.type !== "text" || block.text.length <= maxChars) return block;
      changed = true;
      return { type: "text" as const, text: trimText(block.text, maxChars) };
    });
    if (!changed) return original;
    return { ...original, content };
  };
}
