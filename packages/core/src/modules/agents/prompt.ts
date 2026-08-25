import { readFileSync } from "node:fs";

export function loadPrompt(url: URL, vars: Record<string, string>): string {
  let prompt = readFileSync(url, "utf8");
  for (const [k, v] of Object.entries(vars)) prompt = prompt.replaceAll(`{{${k}}}`, v);
  return prompt;
}
