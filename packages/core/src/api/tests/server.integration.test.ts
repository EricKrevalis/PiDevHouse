import assert from "node:assert/strict";
import { it } from "vitest";
import { ApiServer } from "../server.ts";
import { EventBus } from "../../modules/service/eventBus.service.ts";
import type { Config } from "../../modules/model/config.model.ts";
import type { WorkflowRunner } from "../../modules/model/workflowRunner.model.ts";

class ControlledWorkflowRunner implements WorkflowRunner {
  signal: AbortSignal | undefined;
  private startedResolve!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve;
  });

  run(_config: Config, _runId: string, signal?: AbortSignal): Promise<boolean> {
    this.signal = signal;
    this.startedResolve();
    return new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve(true), { once: true });
    });
  }
}

it("cancels an active workflow before stopping the API server", async () => {
  const runner = new ControlledWorkflowRunner();
  let fetchRequest:
    ((request: Request) => Promise<Response | undefined>) | undefined;
  const previousBun = (globalThis as { Bun?: unknown }).Bun;
  (globalThis as { Bun?: unknown }).Bun = {
    serve(options: {
      fetch: (request: Request) => Promise<Response | undefined>;
    }) {
      fetchRequest = options.fetch;
      return {
        port: 43210,
        stop: async () => {},
        upgrade: () => false,
      };
    },
  };
  const server = new ApiServer({
    eventBus: new EventBus(),
    workflowRunner: runner,
    port: 0,
    shutdownGracePeriodMs: 0,
  });
  server.start();

  try {
    const response = await fetchRequest!(
      new Request(`http://127.0.0.1:${server.listeningPort}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: "test" }),
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 202);
    await runner.started;

    await server.stop();

    assert.equal(runner.signal?.aborted, true);
  } finally {
    await server.stop();
    (globalThis as { Bun?: unknown }).Bun = previousBun;
  }
});
