import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { EventBus } from "../../service/eventBus.service.ts";
import { TerminalView } from "../terminalView.tsx";

it("updates the elapsed display", async () => {
  const eventBus = new EventBus();
  const view = new TerminalView({ eventBus });

  eventBus.publish({
    type: "elapsed",
    runId: "run-1",
    seconds: 61,
    timestamp: new Date().toISOString(),
  });

  assert.equal(view.elapsed, "1m 1s");
  await view.close();
});

it("colors agent labels cyan", async () => {
  const eventBus = new EventBus();
  const view = new TerminalView({ eventBus });

  eventBus.publish({
    type: "agent_start",
    runId: "run-1",
    agent: "developer",
    timestamp: new Date().toISOString(),
  });

  assert.deepEqual(view.output, [
    { content: "developer: ", color: "cyan" },
    { content: "starting...\n", color: undefined },
  ]);
  await view.close();
});

it("skips a GPU warning after text starts", async () => {
  const previousModel = process.env.OLLAMA_MODEL;
  process.env.OLLAMA_MODEL = "model:latest";
  const response = Promise.withResolvers<{
    ok: boolean;
    json: () => Promise<{
      models: { name: string; size: number; size_vram: number }[];
    }>;
  }>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
  const eventBus = new EventBus();
  const view = new TerminalView({ eventBus });

  eventBus.publish({
    type: "thinking_start",
    runId: "run-1",
    agent: "developer",
    timestamp: new Date().toISOString(),
  });
  eventBus.publish({
    type: "text_delta",
    runId: "run-1",
    agent: "developer",
    delta: "Working",
    timestamp: new Date().toISOString(),
  });
  response.resolve({
    ok: true,
    json: async () => ({
      models: [{ name: "model:latest", size: 100, size_vram: 90 }],
    }),
  });
  await response.promise;
  await new Promise((resolve) => setTimeout(resolve));

  assert.doesNotMatch(
    view.output.map((segment) => segment.content).join(""),
    /Warning: model:latest/,
  );
  await view.close();
  vi.unstubAllGlobals();
  if (previousModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = previousModel;
});

it("warns when Ollama only loads part of the model into GPU memory", async () => {
  const previousModel = process.env.OLLAMA_MODEL;
  process.env.OLLAMA_MODEL = "model:latest";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "model:latest", size: 100, size_vram: 90 }],
      }),
    }),
  );
  const eventBus = new EventBus();
  const view = new TerminalView({ eventBus });

  eventBus.publish({
    type: "thinking_start",
    runId: "run-1",
    agent: "developer",
    timestamp: new Date().toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve));

  assert.match(
    view.output.map((segment) => segment.content).join(""),
    /Warning: model:latest runs 10% on CPU \/ 90% on GPU/,
  );
  assert.equal(view.output.find((segment) => segment.color === "yellow")?.color, "yellow");
  await view.close();
  vi.unstubAllGlobals();
  if (previousModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = previousModel;
});

it("reports when Ollama runs the model fully on GPU", async () => {
  const previousModel = process.env.OLLAMA_MODEL;
  process.env.OLLAMA_MODEL = "model:latest";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "model:latest", size: 100, size_vram: 100 }],
      }),
    }),
  );
  const eventBus = new EventBus();
  const view = new TerminalView({ eventBus });

  eventBus.publish({
    type: "thinking_start",
    runId: "run-1",
    agent: "developer",
    timestamp: new Date().toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve));

  assert.match(
    view.output.map((segment) => segment.content).join(""),
    /Model: model:latest runs fully on GPU/,
  );
  assert.equal(view.output.find((segment) => segment.color === "green")?.color, "green");
  await view.close();
  vi.unstubAllGlobals();
  if (previousModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = previousModel;
});
