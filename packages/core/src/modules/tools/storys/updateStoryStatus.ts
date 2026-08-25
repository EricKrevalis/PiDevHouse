import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { STORY_STATUSES } from "../../models/story.model";
import type { StoryRepository } from "../../repository/story.repository";

export function createUpdateStoryStatusTool(
  storyRepository: StoryRepository,
): ToolDefinition {
  const paramsSchema = z.object({
    id: z.number().int().positive(),
    status: z.enum(STORY_STATUSES),
  });

  return {
    name: "update_story_status",
    label: "Update story status",
    description: "Set the status of a story by id.",
    parameters: z.toJSONSchema(paramsSchema),
    async execute(_toolCallId: string, params: z.infer<typeof paramsSchema>) {
      const story = storyRepository.getStory(params.id);
      if (!story) {
        throw new Error(`story ${params.id} not found`);
      }

      const applied = await storyRepository.updateStoryStatus(
        story.id,
        params.status,
      );
      if (!applied) {
        throw new Error(
          `cannot move story ${story.id} from "${story.status}" to "${params.status}"`,
        );
      }
      return toolResult(`Updated story ${story.id} to ${params.status}`);
    },
  };
}

function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
