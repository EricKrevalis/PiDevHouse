import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  requireEnv,
  type ModelProvider,
  type ModelProviderFactory,
} from "./modelProvider.model.ts";

export class OllamaProvider implements ModelProvider {
  readonly modelRuntime: ModelRuntime;
  readonly model: Model<Api>;

  private constructor(modelRuntime: ModelRuntime, model: Model<Api>) {
    this.modelRuntime = modelRuntime;
    this.model = model;
  }

  // real context must match the ollama modelfile's num_ctx for the configured
  // model, else compaction never fires and ollama silently truncates context
  private static envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  static async create(): Promise<OllamaProvider> {
    const ollamaHost = process.env.OLLAMA_HOST ?? "http://localhost:11434";
    const modelId = requireEnv("OLLAMA_MODEL");
    const contextWindow = OllamaProvider.envInt("OLLAMA_CONTEXT_WINDOW", 32_768);
    const maxTokens = OllamaProvider.envInt("OLLAMA_MAX_TOKENS", 16_384);

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
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow,
          maxTokens,
          compat: {
            supportsDeveloperRole: true,
            maxTokensField: "max_tokens",
            supportsReasoningEffort: true,
            thinkingFormat: "openai",
          },
        },
      ],
    });

    const model = modelRuntime.getModel("ollama", modelId);
    if (!model) throw new Error(`ollama model not found: ${modelId}`);

    return new OllamaProvider(modelRuntime, model);
  }
}

export class OllamaProviderFactory implements ModelProviderFactory {
  async create(signal?: AbortSignal): Promise<ModelProvider> {
    signal?.throwIfAborted();
    const provider = await OllamaProvider.create();
    signal?.throwIfAborted();
    return provider;
  }
}
