import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { validationResultSchema } from "../../models/story.model";
import type { StoryRepository } from "../../repository/story.repository";

export type ValidationVariant = "test" | "review";

export function createUpdateValidationResultTool(
  storyRepository: StoryRepository,
  allowedVariants: readonly [ValidationVariant, ...ValidationVariant[]] = [
    "test",
    "review",
  ],
): ToolDefinition {
  const paramsSchema = z.object({
    id: z.number().int().positive(),
    result: validationResultSchema,
    variant: z.enum(allowedVariants),
  });

  return {
    name: "update_validation_result",
    label: "Update validation result",
    description:
      `Set the ${allowedVariants.join(" or ")} result of a story by id.`,
    parameters: z.toJSONSchema(paramsSchema),
    async execute(_toolCallId: string, params: z.infer<typeof paramsSchema>) {
      const story = storyRepository.getStory(params.id);
      if (!story) {
        throw new Error(`story ${params.id} not found`);
      }

      await storyRepository.updateValidationResult(
        story.id,
        params.result,
        params.variant,
      );
      return toolResult(
        `Updated ${params.variant} result for story ${story.id}`,
      );
    },
  };
}

function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
