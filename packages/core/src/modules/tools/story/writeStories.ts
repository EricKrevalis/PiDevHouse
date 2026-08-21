import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
  storiesArraySchema,
  storiesFileSchema,
  StoryStore,
  toolResult,
} from "./stories.ts";

export function createWriteStoriesTool(storyStore: StoryStore): ToolDefinition {
  return {
    name: "write_stories",
    label: "Write stories",
    description:
      "Replace stories.json with a validated story list. Rejected unless every story is valid, ids are unique, and dependencies exist.",
    parameters: z.toJSONSchema(storiesFileSchema),
    async execute(
      _toolCallId: string,
      params: z.infer<typeof storiesFileSchema>,
    ) {
      const check = storiesArraySchema.safeParse(params.stories);
      if (!check.success) {
        return toolResult(`Error: ${check.error.issues[0]?.message}`);
      }
      await storyStore.write(
        check.data.map((story) => ({
          ...story,
          reviewResult: { score: 0, note: "" },
          testResult: { score: 0, note: "" },
        })),
      );
      return toolResult(`Wrote ${check.data.length} stories to stories.json`);
    },
  };
}
