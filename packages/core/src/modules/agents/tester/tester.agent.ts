import type { Path } from "typescript";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Agent } from "../../models/agent.model";
import type { Config } from "../../models/config.model";
import type { LlamaProvider } from "../../models/llamaProvider.model";
import type { StoryRepository } from "../../repository/story.repository";
import type { AgentEventBridge } from "../../services/agentEventBridge";
import type { SummaryCollector } from "../../services/summaryCollector";
import { createUpdateStoryStatusTool } from "../../tools/storys/updateStoryStatus";
import { createBrowserTool } from "../../tools/browser";
import {
  createUpdateValidationResultTool,
  type ValidationVariant,
} from "../../tools/storys/updateValidationResult";
import { createGetStoryTool } from "../../tools/storys/getStory";
import { loadPrompt, TEAM_PREFIX } from "../prompt";

export class TesterAgent extends Agent {
  private browser?: ReturnType<typeof createBrowserTool>;
  private readonly storyId: number;

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
      name: "tester",
      modelProvider,
      systemPrompt: `${TEAM_PREFIX} You are the independent tester.`,
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
    this.storyId = storyId;
  }

  override buildCustomTools(): ToolDefinition[] {
    this.browser ??= createBrowserTool(this.workspace, this.storyId);
    return [
      createUpdateStoryStatusTool(
        this.storyRepository,
        this.browser.capturedCriteria,
      ),
      createUpdateValidationResultTool(this.storyRepository, [
        "test",
      ] as readonly [ValidationVariant]),
      createGetStoryTool(this.storyRepository),
      this.browser.tool,
    ];
  }

  override async cleanup(): Promise<void> {
    await this.browser?.dispose();
  }
}
