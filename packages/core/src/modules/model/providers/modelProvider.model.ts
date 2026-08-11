import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Config } from "../config.model.ts";

export abstract class ModelProvider {
  abstract readonly modelRuntime: ModelRuntime;
  abstract readonly model: Model<Api>;

  protected static requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} not set (copy .env.example to root .env)`);
    }
    return value;
  }

  static create(_config: Config): Promise<ModelProvider> {
    throw new Error("not implemented");
  }
}

export interface ModelProviderFactory {
  create(config: Config, signal?: AbortSignal): Promise<ModelProvider>;
}
