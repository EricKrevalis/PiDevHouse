import { afterEach, expect, test } from "bun:test";
import { LlamaProvider } from "../../src/modules/models/llamaProvider.model";

const originalServer = process.env.LLAMA_SERVER;
const originalModel = process.env.LLAMA_MODEL;
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
  if (originalServer === undefined) delete process.env.LLAMA_SERVER;
  else process.env.LLAMA_SERVER = originalServer;
  if (originalModel === undefined) delete process.env.LLAMA_MODEL;
  else process.env.LLAMA_MODEL = originalModel;
});

function llamaServer(routes: Record<string, unknown> = {}) {
  server = Bun.serve({
    port: 0,
    routes: {
      "/slots": Response.json([{ n_ctx: 65_536 }]),
      ...routes,
    },
  });
  process.env.LLAMA_SERVER = server.url.origin;
  process.env.LLAMA_MODEL = "test-model";
  return LlamaProvider.create();
}

test("accepts the declared context across slots", async () => {
  const provider = await llamaServer();
  expect(await provider.preflight()).toBeUndefined();
});

test("rejects a context mismatch", async () => {
  const provider = await llamaServer({
    "/slots": Response.json([{ n_ctx: 4_096 }]),
  });
  await expect(provider.preflight()).rejects.toThrow(
    "llama-server preflight failed",
  );
});

test("rejects an unreachable server", async () => {
  const provider = await llamaServer({
    "/slots": new Response(null, { status: 500 }),
  });
  await expect(provider.preflight()).rejects.toThrow(
    "llama-server preflight failed",
  );
});
