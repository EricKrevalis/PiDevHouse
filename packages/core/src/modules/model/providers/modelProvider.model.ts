import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface ModelProvider {
  readonly modelRuntime: ModelRuntime;
  readonly model: Model<Api>;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} not set (copy .env.example to root .env)`);
  }
  return value;
}

export interface ModelProviderFactory {
  create(signal?: AbortSignal): Promise<ModelProvider>;
}
