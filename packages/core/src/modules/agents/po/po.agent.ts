import type { Path } from "typescript";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Agent } from "../../models/agent.model";
import type { Config } from "../../models/config.model";
import type { LlamaProvider } from "../../models/llamaProvider.model";
import type { StoryRepository } from "../../repository/story.repository";
import type { AgentEventBridge } from "../../services/agentEventBridge";
import type { SummaryCollector } from "../../services/summaryCollector";
import { createCreateStoriesTool } from "../../tools/storys/createStories";
import { loadPrompt, TEAM_PREFIX } from "../prompt";

export class ProductOwnerAgent extends Agent {
  constructor(
    userRequest: string,
    workspace: Path,
    modelProvider: LlamaProvider,
    config: Config,
    storyRepository: StoryRepository,
    eventBridge: AgentEventBridge,
    summaryCollector: SummaryCollector,
  ) {
    super({
      name: "productOwner",
      modelProvider,
      systemPrompt:
        `${TEAM_PREFIX} You are the product owner. Your only write and final action is a successful create_stories call.`,
      userPrompts: [
        loadPrompt(new URL("./poPrompt.md", import.meta.url), { userRequest }),
      ],
      workspace,
      tools: [],
      config,
      eventBridge,
      summaryCollector,
      storyRepository,
    });
  }

  override buildCustomTools(): ToolDefinition[] {
    return [createCreateStoriesTool(this.storyRepository)];
  }
}
