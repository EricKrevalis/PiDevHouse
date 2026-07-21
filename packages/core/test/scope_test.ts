import { scopeToolCalls } from "../src/tools/scope.ts";

Deno.test("tool limit tells the agent to finish", async () => {
  const agent: { beforeToolCall?: (ctx: any, signal?: AbortSignal) => any } =
    {};
  scopeToolCalls(agent, Deno.cwd());

  let result;
  for (let i = 0; i <= 25; i++) {
    result = await agent.beforeToolCall?.({
      toolCall: { name: "bash" },
      args: {},
    });
  }

  if (!result?.block || !result.reason.includes("complete the task now")) {
    throw new Error("Agent did not receive completion feedback");
  }
});
