import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

export class LlamaProvider {
  readonly modelRuntime: ModelRuntime;
  readonly model: Model<Api>;

  private constructor(
    modelRuntime: ModelRuntime,
    model: Model<Api>,
    private readonly serverUrl: string,
  ) {
    this.modelRuntime = modelRuntime;
    this.model = model;
  }

  static async create(): Promise<LlamaProvider> {
    const serverUrl = env("LLAMA_SERVER");
    const modelId = env("LLAMA_MODEL");

    const modelRuntime = await ModelRuntime.create({ modelsPath: null });
    modelRuntime.registerProvider("llama-server", {
      name: "llama-server",
      baseUrl: `${serverUrl}/v1`,
      apiKey: "none",
      api: "openai-completions",
      models: [
        {
          id: modelId,
          name: modelId,
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 65_536,
          maxTokens: 32_768,
          compat: {
            supportsStore: false,
            supportsDeveloperRole: true,
            supportsReasoningEffort: true,
            supportsStrictMode: false,
            supportsLongCacheRetention: false,
            maxTokensField: "max_tokens",
            thinkingFormat: "openai",
          },
        },
      ],
    });

    const model = modelRuntime.getModel("llama-server", modelId);
    if (!model) throw new Error(`llama-server model not found: ${modelId}`);
    return new LlamaProvider(modelRuntime, model, serverUrl);
  }

  // Fails unless llama-server is up with the expected total slot context.
  async preflight(signal?: AbortSignal): Promise<void> {
    try {
      const response = await fetch(`${this.serverUrl}/slots`, { signal });
      if (!response.ok) {
        throw new Error(`/slots returned HTTP ${response.status}`);
      }
      const slots = (await response.json()) as { n_ctx?: number }[];
      const contextLength = slots.reduce((n, s) => n + (s.n_ctx ?? 0), 0);
      if (contextLength !== this.model.contextWindow) {
        throw new Error(
          `context ${contextLength || "unknown"}; expected ${this.model.contextWindow}`,
        );
      }
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error("llama-server preflight failed", { cause: error });
    }
  }
}
