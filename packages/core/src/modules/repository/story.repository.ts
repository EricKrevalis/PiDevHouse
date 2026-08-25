import { writeFile } from "node:fs/promises";
import type { Path } from "typescript";
import {
  storyStatusTransitions,
  type Story,
  type StoryStatus,
  type ValidationResult,
} from "../models/story.model";

export class StoryRepository {
  stories: Story[] = [];
  storiesPath: Path;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(storiesPath: Path) {
    this.storiesPath = storiesPath;
  }

  async createStories(storys: Story[]) {
    this.stories = [...this.stories, ...storys];
    await this.saveToFile();
  }

  getStories() {
    return this.stories;
  }

  getStory(id: number) {
    return this.stories.find((s) => s.id === id);
  }

  getReadyStory(): Story | undefined {
    return this.stories
      .filter(
        (story) =>
          story.status === "todo" &&
          story.blockedBy.every(
            (dependency) =>
              this.getStory(dependency)?.status === "tested",
          ),
      )
      .sort((a, b) => a.id - b.id)[0];
  }

  /** Returns false when the story is missing or the status move is not allowed. */
  async updateStoryStatus(id: number, status: StoryStatus): Promise<boolean> {
    const story = this.getStory(id);
    if (!story) return false;
    const allowed =
      status === story.status ||
      storyStatusTransitions[story.status].includes(status);
    if (!allowed) return false;
    this.stories = this.stories.map((s) =>
      s.id === id ? { ...s, status } : s,
    );
    await this.saveToFile();
    return true;
  }

  async updateValidationResult(
    id: number,
    result: ValidationResult,
    variant: "test" | "review",
  ) {
    const field = variant === "test" ? "testResult" : "reviewResult";
    this.stories = this.stories.map((s) =>
      s.id === id ? { ...s, [field]: result } : s,
    );
    await this.saveToFile();
  }

  getValidationResult(id: number, variant: "test" | "review") {
    return this.getStory(id)?.[
      variant === "test" ? "testResult" : "reviewResult"
    ];
  }

  private saveToFile(): Promise<void> {
    const contents = `${JSON.stringify(this.stories, null, 2)}\n`;
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(() => writeFile(this.storiesPath, contents));
    return this.saveQueue;
  }
}
