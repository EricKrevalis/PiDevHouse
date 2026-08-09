import { resolve } from "node:path";
import type { Story } from "../modules/model/story.model.ts";
import type {
  AgentUsage,
  StorySummary,
  Summary,
} from "../modules/model/summary.model.ts";

export async function writeSummary(
  runDir: string,
  summary: Summary,
): Promise<void> {
  const contents = `${JSON.stringify(summary, null, 2)}\n`;
  await Promise.all([
    Deno.writeTextFile(resolve(runDir, "summary.json"), contents),
  ]);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type?: string; text?: unknown }>)
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

export async function parseOutputLog(
  logPath: string,
  input: Omit<Summary, "agents" | "stories"> & { stories: Story[] },
): Promise<Summary> {
  const agents: Record<string, AgentUsage> = {};
  let guide: string | undefined;
  const storyMeta = new Map<
    number,
    Pick<StorySummary, "iterations" | "reviewTrajectory" | "testTrajectory">
  >();

  for (const line of (await Deno.readTextFile(logPath)).split("\n")) {
    if (line === "") continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const agentName = String(event.agentName ?? "");
    const storyId = typeof event.story === "number" ? event.story : undefined;

    if (event.type === "message_end" && agentName !== "") {
      const message = event.message as {
        role?: string;
        usage?: { input?: number; output?: number };
        content?: unknown;
      };
      if (message.role === "assistant") {
        if (message.usage) {
          const usage = agents[agentName] ?? {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
          };
          usage.calls += 1;
          usage.inputTokens += message.usage.input ?? 0;
          usage.outputTokens += message.usage.output ?? 0;
          agents[agentName] = usage;
        }
        if (agentName === "guide") {
          const text = messageText(message.content);
          if (text !== "") guide = text;
        }
      }
    }

    if (storyId === undefined) continue;
    const meta = storyMeta.get(storyId) ?? {
      iterations: 0,
      reviewTrajectory: [],
      testTrajectory: [],
    };
    if (typeof event.iteration === "number") {
      meta.iterations = Math.max(meta.iterations, event.iteration);
    }
    if (
      event.type === "tool_execution_start" &&
      event.toolName === "update_story_fields"
    ) {
      const fields = (
        event.args as {
          fields?: {
            reviewResult?: { score?: number };
            testResult?: { score?: number };
          };
        }
      ).fields;
      if (typeof fields?.reviewResult?.score === "number") {
        meta.reviewTrajectory.push(fields.reviewResult.score);
      }
      if (typeof fields?.testResult?.score === "number") {
        meta.testTrajectory.push(fields.testResult.score);
      }
    }
    storyMeta.set(storyId, meta);
  }

  const stories: StorySummary[] = input.stories.map((story) => ({
    id: story.id,
    title: story.title,
    status: story.status,
    reviewScore: story.reviewResult.score,
    testScore: story.testResult.score,
    ...(storyMeta.get(story.id) ?? {
      iterations: 0,
      reviewTrajectory: [],
      testTrajectory: [],
    }),
  }));

  return { ...input, agents, stories, guide };
}
