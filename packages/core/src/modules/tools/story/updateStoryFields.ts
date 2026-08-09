import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
  readStories,
  storiesArraySchema,
  storySchema,
  toolResult,
  writeStoriesFile,
} from "./stories.ts";

export type StoryField = Exclude<keyof typeof storySchema.shape, "id">;

export function createUpdateStoryFieldsTool(
  storiesPath: string,
  allowedFields: readonly StoryField[],
): ToolDefinition {
  const fieldsSchema = z
    .object(
      Object.fromEntries(allowedFields.map((f) => [f, storySchema.shape[f]])),
    )
    .strict();

  const paramsSchema = z.object({
    id: z.number().int().positive(),
    fields: fieldsSchema,
  });

  return {
    name: "update_story_fields",
    label: "Update story fields",
    description:
      `Update allowed fields of one story in stories.json. Writable fields: ${allowedFields.join(", ")}. ` +
      "Rejected unless the story exists and the file stays valid.",
    parameters: z.toJSONSchema(paramsSchema),
    async execute(_toolCallId: string, params: z.infer<typeof paramsSchema>) {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return toolResult(`Error: ${parsed.error.issues[0]?.message}`);
      }

      const state = await readStories(storiesPath);
      if (!state) {
        return toolResult("Error: stories.json is missing or invalid");
      }
      if (!state.stories.some((story) => story.id === parsed.data.id)) {
        return toolResult(`Error: story ${parsed.data.id} not found`);
      }

      const updated = state.stories.map((story) =>
        story.id === parsed.data.id
          ? { ...story, ...parsed.data.fields }
          : story,
      );
      const check = storiesArraySchema.safeParse(updated);
      if (!check.success) {
        return toolResult(`Error: ${check.error.issues[0]?.message}`);
      }

      await writeStoriesFile(storiesPath, check.data);
      return toolResult(
        `Updated story ${parsed.data.id} (${Object.keys(parsed.data.fields).join(", ")})`,
      );
    },
  };
}
