import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

interface EvictOptions {
  highWaterChars: number;
  lowWaterChars: number;
  keepLast: number;
}

const DEFAULT_EVICT: EvictOptions = {
  highWaterChars: 24_000,
  lowWaterChars: 12_000,
  keepLast: 6,
};

function resultTextChars(msg: ToolResultMessage): number {
  let n = 0;
  for (const block of msg.content) {
    if (block.type === "text") n += block.text.length;
  }
  return n;
}

function elide(msg: ToolResultMessage): ToolResultMessage {
  const chars = resultTextChars(msg);
  return {
    ...msg,
    content: [
      {
        type: "text" as const,
        text: `[${msg.toolName} output elided, ${chars} chars — re-run the tool if needed]`,
      },
    ],
  };
}

/**
 * Deterministic stale-tool-result eviction for Agent.transformContext.
 * Hysteresis keeps the context append-only between rewrites, so the server's
 * prefix cache stays hot — unlike compaction, which rewrites the whole prefix.
 */
export function evictStaleToolResults(
  options: Partial<EvictOptions> = {},
): NonNullable<Agent["transformContext"]> {
  const opts = { ...DEFAULT_EVICT, ...options };

  return async (messages: AgentMessage[]) => {
    const toolIdx: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if ((messages[i] as ToolResultMessage).role === "toolResult") {
        toolIdx.push(i);
      }
    }
    if (toolIdx.length <= opts.keepLast) return messages;

    let total = 0;
    for (const i of toolIdx) {
      total += resultTextChars(messages[i] as ToolResultMessage);
    }
    if (total <= opts.highWaterChars) return messages;

    // keep the newest results while they fit in lowWater, plus keepLast
    let firstKept = toolIdx.length;
    let kept = 0;
    for (let j = toolIdx.length - 1; j >= 0; j--) {
      const size = resultTextChars(messages[toolIdx[j]!] as ToolResultMessage);
      if (j < toolIdx.length - opts.keepLast && kept + size > opts.lowWaterChars) {
        break;
      }
      kept += size;
      firstKept = j;
    }
    if (firstKept <= 0) return messages;

    const elideSet = new Set(toolIdx.slice(0, firstKept));
    return messages.map((m, i) =>
      elideSet.has(i) ? elide(m as ToolResultMessage) : m,
    );
  };
}
