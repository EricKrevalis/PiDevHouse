import { z } from "zod";

export const STORY_STATUSES = [
  "todo",
  "in_progress",
  "implemented",
  "approved",
  "tested",
  "blocked",
] as const;

export const storyStatusSchema = z.enum(STORY_STATUSES);

/** Allowed status moves; same-status writes are always allowed. */
export const storyStatusTransitions: Record<StoryStatus, StoryStatus[]> = {
  todo: ["in_progress"],
  in_progress: ["implemented"],
  // developer reworks after failed review/test iterations
  implemented: ["approved", "in_progress"],
  approved: ["tested", "in_progress"],
  tested: [],
  // ponytail: nothing sets blocked yet; wire its edges when something does
  blocked: [],
};

export const validationResultSchema = z.object({
  score: z.number(),
  note: z.string(),
});

export const storySchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  blockedBy: z.array(z.number().int().positive()),
  status: storyStatusSchema,
  reviewResult: validationResultSchema,
  testResult: validationResultSchema,
});

export type StoryStatus = z.infer<typeof storyStatusSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
export type Story = z.infer<typeof storySchema>;

/** Validation checks: return true when `value` is valid. */
export const isStoryStatus = (value: unknown): value is StoryStatus =>
  storyStatusSchema.safeParse(value).success;

export const isValidationResult = (value: unknown): value is ValidationResult =>
  validationResultSchema.safeParse(value).success;

export const isStory = (value: unknown): value is Story =>
  storySchema.safeParse(value).success;
