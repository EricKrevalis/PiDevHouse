import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export abstract class ModelProvider {
  abstract readonly modelRuntime: ModelRuntime;
  abstract readonly model: Model<Api>;

  protected static requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) {
      throw new Error(`${name} not set (copy .env.example to root .env)`);
    }
    return value;
  }

  static create();
}
