import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { createSandboxedBashTool } from "./bash.ts";
import type { StoryField } from "./story/updateStoryFields.ts";
import { createUpdateStoryFieldsTool } from "./story/updateStoryFields.ts";
import { createWriteStoriesTool } from "./story/writeStories.ts";

export const TOOLS = {
  read: "read",
  write: "write",
  edit: "edit",
  grep: "grep",
  find: "find",
  ls: "ls",
  bash: "bash",
  writeStories: "write_stories",
  updateStoryFields: "update_story_fields",
} as const;

export type Tools = (typeof TOOLS)[keyof typeof TOOLS];

export const STORIES_PATH = "stories.json";

export type ToolRef =
  | Tools
  | {
      name: typeof TOOLS.updateStoryFields;
      config: { allowedFields: readonly StoryField[] };
    };

export function toolName(ref: ToolRef): Tools {
  return typeof ref === "string" ? ref : ref.name;
}

export function createCustomTools(
  refs: readonly ToolRef[],
  workspaceDir: string,
): ToolDefinition[] {
  return refs.flatMap((ref) => {
    switch (toolName(ref)) {
      case TOOLS.bash:
        return [defineTool(createSandboxedBashTool(workspaceDir))];
      case TOOLS.writeStories:
        return [createWriteStoriesTool(resolve(workspaceDir, STORIES_PATH))];
      case TOOLS.updateStoryFields:
        return [
          createUpdateStoryFieldsTool(
            resolve(workspaceDir, STORIES_PATH),
            typeof ref === "string" ? [] : ref.config.allowedFields,
          ),
        ];
      default:
        return [];
    }
  });
}
