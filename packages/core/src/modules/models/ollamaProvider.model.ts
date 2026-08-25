import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const OLLAMA_PREFLIGHT_TIMEOUT_MS = 10_000;

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
  private gpuWarned = false;

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
          contextWindow: 32_768,
          maxTokens: 16_384,
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

  async warnIfNotOnGpu(signal?: AbortSignal): Promise<string | undefined> {
    if (this.gpuWarned) return;
    this.gpuWarned = true;
    try {
      const timeoutSignal = AbortSignal.timeout(OLLAMA_PREFLIGHT_TIMEOUT_MS);
      const fetchSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      // Load the model into memory first so /api/ps can report the GPU split.
      await fetch(`${this.ollamaHost}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.modelId, keep_alive: "5m" }),
        signal: fetchSignal,
      });
      const data = (await (
        await fetch(`${this.ollamaHost}/api/ps`, { signal: fetchSignal })
      ).json()) as {
        models: {
          name?: string;
          size?: number;
          size_vram?: number;
          size_total?: number;
        }[];
      };
      const baseName = this.modelId.split(":")[0];
      const loaded = data.models.find(
        (m) => m.name?.split(":")[0] === baseName,
      );
      if (!loaded) return;
      const total = loaded.size_total ?? loaded.size ?? 0;
      const vram = loaded.size_vram ?? 0;
      if (total > 0 && vram >= total) return;
      return `${this.modelId} is not running entirely on the GPU`;
    } catch {
      signal?.throwIfAborted();
      // GPU detection is advisory; network failure or its own timeout is harmless.
    }
  }
}
