import { GuideAgent } from "../modules/agents/guide.agent.ts";
import { ProductOwnerAgent } from "../modules/agents/po.agent.ts";
import type { WorkflowAgentFactory } from "../modules/model/workflowAgentFactory.model.ts";

export class DefaultWorkflowAgentFactory implements WorkflowAgentFactory {
  createProductOwner(
    options: Parameters<WorkflowAgentFactory["createProductOwner"]>[0],
  ) {
    return new ProductOwnerAgent(
      options.request,
      options.storiesPath,
      options.workspace,
      options.modelProvider,
      options.timeoutMinutes,
      options.runId,
      options.dependencies,
    );
  }

  createGuide(options: Parameters<WorkflowAgentFactory["createGuide"]>[0]) {
    return new GuideAgent(
      options.workspace,
      options.modelProvider,
      options.runId,
      options.dependencies,
    );
  }
}
