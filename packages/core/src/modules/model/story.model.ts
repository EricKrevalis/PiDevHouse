export const STORY_STATUSES = [
  "todo",
  "in_progress",
  "implemented",
  "approved",
  "tested",
  "blocked",
] as const;

export type StoryStatus = (typeof STORY_STATUSES)[number];

export interface ValidationResult {
  score: number;
  note: string;
}

export interface Story {
  id: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  blockedBy: number[];
  status: StoryStatus;
  reviewResult: ValidationResult;
  testResult: ValidationResult;
}
