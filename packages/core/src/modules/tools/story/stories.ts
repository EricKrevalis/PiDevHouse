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
  );

export const storiesFileSchema = z.object({ stories: storiesArraySchema });

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

export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = turn;
    return previous.then(() => release);
  }
}

export class StoryStore {
  private readonly mutex = new Mutex();

  constructor(readonly path: string) {}

  read(): Promise<{ stories: Story[] } | null> {
    return readStories(this.path);
  }

  write(stories: Story[]): Promise<void> {
    return writeStoriesFile(this.path, stories);
  }

  acquire(): Promise<() => void> {
    return this.mutex.acquire();
  }

  async block(
    storyId: number,
    terminalStatus?: Story["status"],
    allowTerminal = false,
  ): Promise<boolean> {
    const release = await this.acquire();
    try {
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
    } finally {
      release();
    }
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
