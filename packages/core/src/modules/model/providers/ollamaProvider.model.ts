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

  static async create(): Promise<OllamaProvider> {
    const ollamaHost = process.env.OLLAMA_HOST ?? "http://localhost:11434";
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
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32_768,
          maxTokens: 16_384,
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
