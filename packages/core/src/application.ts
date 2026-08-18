import { AgentEventBridge } from "./modules/service/agentEventBridge.ts";
import { EventBus } from "./modules/service/eventBus.service.ts";
import { OllamaProviderFactory } from "./modules/model/providers/ollamaProvider.model.ts";
import { StoryRunner } from "./runtime/storyRunner.ts";
import { DefaultWorkflowAgentFactory } from "./runtime/workflowAgentFactory.ts";
import { WorkflowService } from "./runtime/workflow.ts";

export function createApplicationContext() {
  const eventBus = new EventBus();
  const agentEventBridge = new AgentEventBridge(eventBus);
  const storyRunner = new StoryRunner(eventBus);
  const workflowService = new WorkflowService({
    messagePublisher: eventBus,
    agentEventBridge,
    storyRunner,
    providerFactory: new OllamaProviderFactory(),
    agentFactory: new DefaultWorkflowAgentFactory(),
  });

  return { eventBus, workflowService };
}
