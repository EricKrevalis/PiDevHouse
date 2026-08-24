import {
  createEditToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../model/workspace.model.ts";
import { createSandboxedBashTool } from "./bash.ts";
import type { StoryField } from "./story/updateStoryFields.ts";
import { createUpdateStoryFieldsTool } from "./story/updateStoryFields.ts";
import { createWriteStoriesTool } from "./story/writeStories.ts";
import type { StoryStore } from "./story/stories.ts";

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

export const AGENTS_PATH = "AGENTS.md";

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
  workspace: Workspace,
  storyStore: StoryStore,
): ToolDefinition[] {
  return refs.flatMap((ref) => {
    switch (toolName(ref)) {
      case TOOLS.bash:
        return [defineTool(createSandboxedBashTool(workspace))];
      case TOOLS.write:
        return [defineTool(createWriteToolDefinition(workspace.workspaceDir))];
      case TOOLS.edit:
        return [defineTool(createEditToolDefinition(workspace.workspaceDir))];
      case TOOLS.writeStories:
        return [createWriteStoriesTool(storyStore)];
      case TOOLS.updateStoryFields:
        return [
          createUpdateStoryFieldsTool(
            storyStore,
            typeof ref === "string" ? [] : ref.config.allowedFields,
          ),
        ];
      default:
        return [];
    }
  });
}
