import { afterEach, expect, test } from "bun:test";
import { OllamaProvider } from "../../src/modules/models/ollamaProvider.model";

const originalHost = process.env.OLLAMA_HOST;
const originalModel = process.env.OLLAMA_MODEL;
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
  if (originalHost === undefined) delete process.env.OLLAMA_HOST;
  else process.env.OLLAMA_HOST = originalHost;
  if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = originalModel;
});

async function providerWithContext(contextLength: number) {
  server = Bun.serve({
    port: 0,
    routes: {
      "/api/generate": new Response("{}"),
      "/api/ps": Response.json({
        models: [
          {
            name: "test-model:latest",
            context_length: contextLength,
            size: 1,
            size_vram: 1,
          },
        ],
      }),
    },
  });
  process.env.OLLAMA_HOST = server.url.origin;
  process.env.OLLAMA_MODEL = "test-model";
  return OllamaProvider.create();
}

test("accepts the declared Ollama context", async () => {
  const provider = await providerWithContext(32_768);
  expect(await provider.preflight()).toBeUndefined();
});

test("rejects an Ollama context mismatch", async () => {
  const provider = await providerWithContext(4_096);
  await expect(provider.preflight()).rejects.toThrow(
    "Ollama preflight failed for test-model",
  );
});

test("loads a cold model before checking its context", async () => {
  let loaded = false;
  let loadCalls = 0;
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/api/ps") {
        return Response.json({
          models: loaded
            ? [
                {
                  name: "test-model:latest",
                  context_length: 32_768,
                  size: 1,
                  size_vram: 1,
                },
              ]
            : [],
        });
      }
      if (path === "/api/generate") {
        loadCalls++;
        expect(await request.json()).toMatchObject({ stream: false });
        loaded = true;
        return Response.json({});
      }
      return new Response(null, { status: 404 });
    },
  });
  process.env.OLLAMA_HOST = server.url.origin;
  process.env.OLLAMA_MODEL = "test-model";

  const provider = await OllamaProvider.create();
  expect(await provider.preflight()).toBeUndefined();
  expect(loadCalls).toBe(1);
});
