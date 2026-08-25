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
export type StoryRunOutcome = "completed" | "stalled" | "max_iterations";

export async function runStory(
  config: Config,
  story: Story,
  workspace: Path,
  modelProvider: OllamaProvider,
  storyRepository: StoryRepository,
  eventBridge: AgentEventBridge,
  summaryCollector: SummaryCollector,
  signal?: AbortSignal,
  agentRunner: typeof runAgent = runAgent,
): Promise<StoryRunOutcome> {
  const invoke = (agentClass: AgentClass, iteration: number) =>
    agentRunner(
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
    );

  for (let iteration = 1; iteration <= config.maxIteration; iteration++) {
    await invoke(DeveloperAgent, iteration);

    const previousReviewResult = storyRepository.getValidationResult(
      story.id,
      "review",
    );
    const reviewed = await collectResult(
      await invoke(ReviewerAgent, iteration),
      storyRepository,
      story.id,
      iteration,
      "review",
      previousReviewResult,
      signal,
    );
    if (!reviewed) return "stalled";
    if (
      reviewed.status !== "approved" ||
      reviewed.reviewResult.score < config.minScore
    )
      continue;

    const previousTestResult = storyRepository.getValidationResult(
      story.id,
      "test",
    );
    const tested = await collectResult(
      await invoke(TesterAgent, iteration),
      storyRepository,
      story.id,
      iteration,
      "test",
      previousTestResult,
      signal,
    );
    if (!tested) return "stalled";
    if (
      tested.status !== "tested" ||
      tested.testResult.score < config.minScore
    )
      continue;

    return "completed";
  }
  return "max_iterations";
}

async function collectResult(
  agent: Agent,
  storyRepository: StoryRepository,
  storyId: number,
  iteration: number,
  variant: "review" | "test",
  previousResult: Story["reviewResult"] | undefined,
  signal?: AbortSignal,
): Promise<Story | undefined> {
  const field = variant === "test" ? "testResult" : "reviewResult";
  let story = storyRepository.getStory(storyId);
  if (!story || story[field] === previousResult) {
    agent.eventBridge.retry(
      { agent: agent.name, storyId, iteration },
      `No fresh ${variant} result was recorded.`,
    );
    await agent.prompt(reminder(storyId, variant), signal);
    story = storyRepository.getStory(storyId);
  }
  return story && story[field] !== previousResult ? story : undefined;
}

function reminder(storyId: number, variant: "review" | "test"): string {
  return `You finished without recording your result for story ${storyId}. Call update_validation_result with variant "${variant}" now, and update_story_status if it passes, then reply.`;
}
