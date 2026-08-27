import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { storySchema } from "../../models/story.model";
import type { StoryRepository } from "../../repository/story.repository";

export function createCreateStoriesTool(
  storyRepository: StoryRepository,
): ToolDefinition {
  const storiesInputSchema = z.array(
    storySchema
      .omit({ reviewResult: true, testResult: true })
      .extend({ status: z.literal("todo") }),
  );
  const paramsSchema = z.object({ stories: storiesInputSchema });

  return {
    name: "create_stories",
    label: "Create stories",
    description:
      "Create or replace the complete story plan. Review and test results default to empty.",
    parameters: z.toJSONSchema(paramsSchema),
    async execute(_toolCallId: string, params: z.infer<typeof paramsSchema>) {
      const ids = params.stories.map((story) => story.id);
      const duplicates = ids.filter(
        (id, index) => ids.indexOf(id) !== index,
      );
      if (duplicates.length > 0) {
        throw new Error(
          `duplicate story ids: ${[...new Set(duplicates)].join(", ")}`,
        );
      }

      const created = params.stories.map(
        ({ id, title, description, acceptanceCriteria, blockedBy, status }) => ({
          id,
          title,
          description,
          acceptanceCriteria,
          blockedBy,
          status,
          reviewResult: { score: 0, note: "" },
          testResult: { score: 0, note: "" },
        }),
      );
      await storyRepository.createStories(created);
      return toolResult(`Created ${created.length} stories`);
    },
  };
}

function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
