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
import { loadPrompt } from "../prompt";

export class TesterAgent extends Agent {
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
      name: "tester",
      modelProvider,
      systemPrompt:
        "You are the independent tester of Concentus, a small AI software team.",
      userPrompts: [
        loadPrompt(new URL("./testerPrompt.md", import.meta.url), {
          storyId: String(storyId),
          minScore: String(config.minScore),
        }),
      ],
      workspace,
      tools: ["read", "bash", "edit"],
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
        "test",
      ] as readonly [ValidationVariant]),
      createGetStoryTool(this.storyRepository),
    ];
  }
}
