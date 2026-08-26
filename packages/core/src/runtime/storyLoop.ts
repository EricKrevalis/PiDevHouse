import { DeveloperAgent } from "../modules/agents/developer/developer.agent";
import { ReviewerAgent } from "../modules/agents/reviewer/reviewer.agent";
import { TesterAgent } from "../modules/agents/tester/tester.agent";
import { runAgent, type Agent } from "../modules/models/agent.model";
import type { Config } from "../modules/models/config.model";
import type { OllamaProvider } from "../modules/models/ollamaProvider.model";
import type { Story } from "../modules/models/story.model";
import type { StoryRepository } from "../modules/repository/story.repository";
import type { AgentEventBridge } from "../modules/services/agentEventBridge";
import type { SummaryCollector } from "../modules/services/summaryCollector";
import type { Path } from "typescript";

type AgentClass = new (...args: any[]) => Agent;
export type StoryRunOutcome = "completed" | "max_iterations";

export async function runStory(
  config: Config,
  story: Story,
  workspace: Path,
  modelProvider: OllamaProvider,
  storyRepository: StoryRepository,
  eventBridge: AgentEventBridge,
  summaryCollector: SummaryCollector,
  signal?: AbortSignal,
): Promise<StoryRunOutcome> {
  const invoke = (
    agentClass: AgentClass,
    iteration: number,
    keepSession = false,
  ) =>
    runAgent(
      agentClass,
      workspace,
      modelProvider,
      config,
      storyRepository,
      eventBridge,
      summaryCollector,
      story.id,
      iteration,
      signal,
      keepSession,
    );

  const validate = async (
    agentClass: AgentClass,
    agent: "reviewer" | "tester",
    variant: "review" | "test",
    iteration: number,
  ) => {
    const previous = storyRepository.getValidationResult(story.id, variant);
    const agentSession = await invoke(agentClass, iteration, true);
    try {
      let result = storyRepository.getStory(story.id);
      // objects are not the same if agent changed it
      if (storyRepository.getValidationResult(story.id, variant) !== previous) {
        return result;
      }

      eventBridge.retry(
        { agent, storyId: story.id, iteration },
        `No ${variant} result was recorded. Please update the story before ending.`,
      );
      await agentSession.prompt(
        `You finished without recording your result for story ${story.id}. Call update_validation_result with variant "${variant}" now, and update_story_status if it passes, then reply.`,
        signal,
      );
      result = storyRepository.getStory(story.id);
      return storyRepository.getValidationResult(story.id, variant) !== previous
        ? result
        : undefined;
    } finally {
      await agentSession.close?.();
    }
  };

  for (let iteration = 1; iteration <= config.maxIteration; iteration++) {
    await invoke(DeveloperAgent, iteration);

    const reviewed = await validate(
      ReviewerAgent,
      "reviewer",
      "review",
      iteration,
    );
    if (
      !reviewed ||
      reviewed.status !== "approved" ||
      reviewed.reviewResult.score < config.minScore
    )
      continue;

    const tested = await validate(TesterAgent, "tester", "test", iteration);
    if (
      !tested ||
      tested.status !== "tested" ||
      tested.testResult.score < config.minScore
    )
      continue;

    return "completed";
  }
  return "max_iterations";
}
