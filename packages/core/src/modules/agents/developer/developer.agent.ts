import type { Path } from "typescript";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Agent } from "../../models/agent.model";
import type { Config } from "../../models/config.model";
import type { LlamaProvider } from "../../models/llamaProvider.model";
import type { StoryRepository } from "../../repository/story.repository";
import type { AgentEventBridge } from "../../services/agentEventBridge";
import type { SummaryCollector } from "../../services/summaryCollector";
import { createUpdateStoryStatusTool } from "../../tools/storys/updateStoryStatus";
import { createGetStoryTool } from "../../tools/storys/getStory";
import { loadPrompt, TEAM_PREFIX } from "../prompt";

export class DeveloperAgent extends Agent {
  constructor(
    storyId: number,
    workspace: Path,
    modelProvider: LlamaProvider,
    config: Config,
    storyRepository: StoryRepository,
    eventBridge: AgentEventBridge,
    summaryCollector: SummaryCollector,
  ) {
    super({
      name: "developer",
      modelProvider,
      systemPrompt:
        `${TEAM_PREFIX} You are the developer. Implement production changes and unit tests only.`,
      userPrompts: [
        loadPrompt(new URL("./developerPrompt.md", import.meta.url), {
          storyId: String(storyId),
        }),
      ],
      workspace,
      tools: ["read", "bash", "edit", "write"],
      config,
      eventBridge,
      summaryCollector,
      storyRepository,
    });
  }

  override buildCustomTools(): ToolDefinition[] {
    return [
      createUpdateStoryStatusTool(this.storyRepository),
      createGetStoryTool(this.storyRepository),
    ];
  }
}
