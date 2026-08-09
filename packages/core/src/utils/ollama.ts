import { type Api, type Model } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { requireEnv } from "./utils.ts";
export interface ModelEnv {
  modelRuntime: ModelRuntime;
  model: Model<Api>;
}

export async function createOllamaRuntime(): Promise<ModelEnv> {
  const ollamaHost = Deno.env.get("OLLAMA_HOST") ?? "http://localhost:11434";
  const modelId = requireEnv("OLLAMA_MODEL");

  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
  });

  modelRuntime.registerProvider("ollama", {
    name: "ollama",
    baseUrl: `${ollamaHost}/v1`,
    apiKey: "ollama",
    api: "openai-completions",
    models: [
      {
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 65_536,
        maxTokens: 16_384,
        compat: {
          supportsDeveloperRole: true,
          supportsReasoningEffort: false,
        },
      },
    ],
  });

  const model = modelRuntime.getModel("ollama", modelId);
  if (!model) throw new Error(`ollama model not found: ${modelId}`);

  return { modelRuntime, model };
}
