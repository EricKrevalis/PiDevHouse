import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
  storiesArraySchema,
  storiesInputSchema,
  StoryStore,
  toolResult,
} from "./stories.ts";

export function createWriteStoriesTool(storyStore: StoryStore): ToolDefinition {
  return {
    name: "write_stories",
    label: "Write stories",
    description:
      "Replace stories.json with a validated story list. Rejected unless every story is valid, ids are unique, and dependencies exist, form no cycle, and leave at least one story unblocked. The reviewer and tester set the scores later, so do not supply them.",
    // the input schema omits reviewResult/testResult. they are overwritten with
    // zeros below either way, so requiring them only spent output tokens in the
    // least instrumented stage of the run and gave the schema one more way to
    // reject an otherwise sound plan.
    parameters: z.toJSONSchema(storiesInputSchema),
    async execute(
      _toolCallId: string,
      params: z.infer<typeof storiesInputSchema>,
    ) {
      const check = storiesArraySchema.safeParse(
        (params.stories ?? []).map((story) => ({
          ...story,
          reviewResult: { score: 0, note: "" },
          testResult: { score: 0, note: "" },
        })),
      );
      if (!check.success) {
        return toolResult(`Error: ${check.error.issues[0]?.message}`);
      }
      await storyStore.write(check.data);
      return toolResult(`Wrote ${check.data.length} stories to stories.json`);
    },
  };
}
