import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

type LoadedModel = {
  name?: string;
  size?: number;
  size_vram?: number;
  size_total?: number;
  context_length?: number;
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} not set (copy .env.example to root .env)`);
  }
  return value;
}

export class OllamaProvider {
  readonly modelRuntime: ModelRuntime;
  readonly model: Model<Api>;
  private preflightComplete = false;

  private constructor(
    modelRuntime: ModelRuntime,
    model: Model<Api>,
    private readonly ollamaHost: string,
    private readonly modelId: string,
  ) {
    this.modelRuntime = modelRuntime;
    this.model = model;
  }

  static async create(): Promise<OllamaProvider> {
    const ollamaHost = requireEnv("OLLAMA_HOST");
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

    const model = modelRuntime.getModel("ollama", modelId);
    if (!model) throw new Error(`ollama model not found: ${modelId}`);

    return new OllamaProvider(modelRuntime, model, ollamaHost, modelId);
  }

  async preflight(signal?: AbortSignal): Promise<string | undefined> {
    if (this.preflightComplete) return;
    try {
      let loaded = await this.getLoadedModel(signal);
      if (!loaded) {
        const loadResponse = await fetch(`${this.ollamaHost}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.modelId,
            keep_alive: "60m",
            stream: false,
          }),
          signal,
        });
        if (!loadResponse.ok) {
          throw new Error(
            `Ollama model load returned HTTP ${loadResponse.status}`,
          );
        }
        await loadResponse.arrayBuffer();
        loaded = await this.getLoadedModel(signal);
      }
      if (!loaded)
        throw new Error(`Ollama model ${this.modelId} is not loaded`);
      if (loaded.context_length !== this.model.contextWindow) {
        throw new Error(
          `Ollama loaded ${this.modelId} with context ${loaded.context_length ?? "unknown"}; expected ${this.model.contextWindow}`,
        );
      }
      this.preflightComplete = true;
      const total = loaded.size_total ?? loaded.size ?? 0;
      const vram = loaded.size_vram ?? 0;
      if (total > 0 && vram >= total) return;
      return `${this.modelId} is not running entirely on the GPU`;
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(`Ollama preflight failed for ${this.modelId}`, {
        cause: error,
      });
    }
  }

  private async getLoadedModel(
    signal?: AbortSignal,
  ): Promise<LoadedModel | undefined> {
    const response = await fetch(`${this.ollamaHost}/api/ps`, {
      signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama /api/ps returned HTTP ${response.status}`);
    }
    const data = (await response.json()) as { models: LoadedModel[] };
    const baseName = this.modelId.split(":")[0];
    return data.models.find(
      (model) =>
        model.name === this.modelId ||
        (!this.modelId.includes(":") && model.name === `${baseName}:latest`),
    );
  }
}
