import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { StoryRepository } from "../../repository/story.repository";

export function createGetStoryTool(
  storyRepository: StoryRepository,
): ToolDefinition {
  const paramsSchema = z.object({
    id: z.number().int().positive(),
  });

  return {
    name: "get_story",
    label: "Get story",
    description: "Get one story by id.",
    parameters: z.toJSONSchema(paramsSchema),
    async execute(_toolCallId: string, params: z.infer<typeof paramsSchema>) {
      const story = storyRepository.getStory(params.id);
      if (!story) {
        throw new Error(`story ${params.id} not found`);
      }

      return toolResult(JSON.stringify(story));
    },
  };
}

function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
