import type { Path } from "typescript";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Agent } from "../../models/agent.model";
import type { Config } from "../../models/config.model";
import type { OllamaProvider } from "../../models/ollamaProvider.model";
import type { StoryRepository } from "../../repository/story.repository";
import type { AgentEventBridge } from "../../services/agentEventBridge";
import type { SummaryCollector } from "../../services/summaryCollector";
import { createUpdateStoryStatusTool } from "../../tools/storys/updateStoryStatus";
import {
  createUpdateValidationResultTool,
  type ValidationVariant,
} from "../../tools/storys/updateValidationResult";
import { createGetStoryTool } from "../../tools/storys/getStory";
import { loadPrompt, TEAM_PREFIX } from "../prompt";

export class ReviewerAgent extends Agent {
  constructor(
    storyId: number,
    workspace: Path,
    modelProvider: OllamaProvider,
    config: Config,
    storyRepository: StoryRepository,
    eventBridge: AgentEventBridge,
    summaryCollector: SummaryCollector,
  ) {
    super({
      name: "reviewer",
      modelProvider,
      systemPrompt:
        `${TEAM_PREFIX} You are the independent reviewer. update_story_status and update_validation_result are your only writes.`,
      userPrompts: [
        loadPrompt(new URL("./reviewerPrompt.md", import.meta.url), {
          storyId: String(storyId),
          minScore: String(config.minScore),
        }),
      ],
      workspace,
      tools: ["read", "bash", "grep"],
      config,
      eventBridge,
      summaryCollector,
      storyRepository,
    });
  }

  override buildCustomTools(): ToolDefinition[] {
    return [
      createUpdateStoryStatusTool(this.storyRepository),
      createUpdateValidationResultTool(this.storyRepository, [
        "review",
      ] as readonly [ValidationVariant]),
      createGetStoryTool(this.storyRepository),
    ];
  }
}
