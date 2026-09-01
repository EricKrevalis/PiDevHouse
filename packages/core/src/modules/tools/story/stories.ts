import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import { type Story, STORY_STATUSES } from "../../model/story.model.ts";

export const storySchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  blockedBy: z.array(z.number().int()),
  status: z.enum(STORY_STATUSES),
  reviewResult: z.object({
    score: z.number().min(-1).max(100),
    note: z.string(),
  }),
  testResult: z.object({ score: z.number().min(-1).max(100), note: z.string() }),
});

// a dependency cycle passes every per-story check: each id exists and none
// points at itself. the run then plans fine, finds nothing ready on the first
// scheduling pass, and ends as a dependency failure having built nothing. this
// validator's message is the only automatic feedback the product owner ever
// gets, so the cheapest place to catch it is here, while it can still retry.
function hasCycle(stories: { id: number; blockedBy: number[] }[]): boolean {
  const blockers = new Map(
    stories.map((story) => [story.id, story.blockedBy]),
  );
  const state = new Map<number, "visiting" | "done">();
  const visit = (id: number): boolean => {
    const seen = state.get(id);
    if (seen === "done") return false;
    if (seen === "visiting") return true;
    state.set(id, "visiting");
    for (const next of blockers.get(id) ?? []) {
      if (visit(next)) return true;
    }
    state.set(id, "done");
    return false;
  };
  return stories.some((story) => visit(story.id));
}

export const storiesArraySchema = z
  .array(storySchema)
  .min(1)
  .refine(
    (stories) => {
      const ids = new Set(stories.map((story) => story.id));
      return (
        ids.size === stories.length &&
        stories.every((story) =>
          story.blockedBy.every((id) => id !== story.id && ids.has(id)),
        )
      );
    },
    { message: "duplicate ids or invalid dependencies" },
  )
  .refine((stories) => !hasCycle(stories), {
    message:
      "dependency cycle: some stories block each other, so none can ever start",
  })
  .refine((stories) => stories.some((story) => story.blockedBy.length === 0), {
    message: "no story is unblocked, so the run has nothing to start with",
  });

export const storiesFileSchema = z.object({ stories: storiesArraySchema });

// what the product owner is asked to supply. reviewResult and testResult are
// deliberately absent: writeStories overwrites both with zeros, so requiring
// them made the model emit fields that were discarded and gave the schema an
// extra way to reject a plan that was otherwise fine.
export const storiesInputSchema = z.object({
  stories: z
    .array(storySchema.omit({ reviewResult: true, testResult: true }))
    .min(1),
});

export function validateStories(
  contents: string,
): { stories: Story[] } | string {
  try {
    const result = storiesFileSchema.safeParse(JSON.parse(contents));
    return result.success
      ? { stories: result.data.stories }
      : `Invalid stories: ${result.error}`;
  } catch (error) {
    if (error instanceof SyntaxError) return "stories.json is not valid JSON";
    throw error;
  }
}

export async function readStories(
  path: string,
): Promise<{ stories: Story[] } | null> {
  try {
    const state = validateStories(await readFile(path, "utf8"));
    return typeof state === "string" ? null : state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export class StoryStore {
  constructor(readonly path: string) {}

  read(): Promise<{ stories: Story[] } | null> {
    return readStories(this.path);
  }

  write(stories: Story[]): Promise<void> {
    return writeStoriesFile(this.path, stories);
  }

  async setStatus(storyId: number, status: Story["status"]): Promise<void> {
    const state = await this.read();
    const story = state?.stories.find((item) => item.id === storyId);
    if (
      !state ||
      !story ||
      story.status === "blocked" ||
      story.status === status
    ) {
      return;
    }
    await this.write(
      state.stories.map((item) =>
        item.id === storyId ? { ...item, status } : item,
      ),
    );
  }

  async block(
    storyId: number,
    terminalStatus?: Story["status"],
    allowTerminal = false,
  ): Promise<boolean> {
    const state = await this.read();
    const story = state?.stories.find((item) => item.id === storyId);
    if (
      !state ||
      !story ||
      story.status === "blocked" ||
      (story.status === terminalStatus && !allowTerminal)
    ) {
      return false;
    }

    await this.write(
      state.stories.map((item) =>
        item.id === storyId ? { ...item, status: "blocked" as const } : item,
      ),
    );
    return true;
  }
}

export async function writeStoriesFile(
  path: string,
  stories: Story[],
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ stories }, null, 2)}\n`);
    await rename(temporaryPath, path);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
