import { readFileSync } from "node:fs";

/** Shared system-prompt prefix so every agent session reuses the same prompt-cache prefix. */
export const TEAM_PREFIX = "You are an agent of Concentus, a small AI software team.";

export function loadPrompt(url: URL, vars: Record<string, string>): string {
  let prompt = readFileSync(url, "utf8");
  for (const [k, v] of Object.entries(vars)) prompt = prompt.replaceAll(`{{${k}}}`, v);
  return prompt;
}
