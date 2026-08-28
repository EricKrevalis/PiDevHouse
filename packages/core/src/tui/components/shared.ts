import type { ActivityEntry, ToolStatus } from "../activity";

export const theme = {
  background: "#24273a",
  element: "#363a4f",
  text: "#cad3f5",
  muted: "#8087a2",
  primary: "#c6a0f6",
  secondary: "#f5bde6",
  tertiary: "#f0c6c6",
  info: "#8bd5ca",
  success: "#a6da95",
  warning: "#eed49f",
  error: "#ed8796",
} as const;

export const spinnerFrames = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];
const agentColors: Record<string, string> = {
  productOwner: theme.primary,
  developer: theme.info,
  reviewer: theme.tertiary,
  tester: theme.warning,
};
export const modelLabel = process.env.OLLAMA_MODEL ?? "ollama";

export type AgentContext = {
  agent: string;
  storyId?: number;
  iteration?: number;
};

export type InputElement = { value: string; focus: () => void };

export type ViewProps = {
  context: AgentContext;
  totalStories: number;
  activity: ActivityEntry[];
  running: boolean;
  thinking: boolean;
  progressFrame: number;
  seconds: number;
  inputRef: (element: InputElement | undefined) => void;
  onSubmit: (value: unknown) => void;
};

export function lineColor(line: string): string {
  if (line.startsWith("› ")) return theme.primary;
  if (line.startsWith("retry ·")) return theme.warning;
  if (line.startsWith("warning ·")) return theme.warning;
  if (line.startsWith("score ")) return theme.warning;
  if (line.startsWith("stories:")) return theme.muted;
  if (line.startsWith("total elapsed ·")) return theme.success;
  return theme.text;
}

export function toolStatus(status: ToolStatus, frame: number): string {
  if (status === "running") {
    return spinnerFrames[frame] ?? spinnerFrames[0] ?? "⋯";
  }
  return status === "error" ? "✗" : "✓";
}

export function toolColor(status: ToolStatus): string {
  if (status === "running") return theme.info;
  return status === "error" ? theme.error : theme.muted;
}

export function formatToolArgs(
  args: Record<string, unknown> | undefined,
  tool: string,
): string {
  if (!args || Object.keys(args).length === 0) return "";
  if (tool === "read" || tool === "write" || tool === "edit") {
    const path = args.path ?? args.file_path;
    return path === undefined ? "" : ` [${singleLine(String(path))}]`;
  }
  if (tool === "bash" || tool === "shell") {
    const command = args.command;
    return command === undefined ? "" : ` [${singleLine(String(command))}]`;
  }
  return ` [${singleLine(
    Object.entries(args)
      .map(([key, value]) => `${key}=${formatToolValue(value)}`)
      .join(", "),
  )}]`;
}

function formatToolValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function singleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

export function composerAgent(agent: string): string {
  if (agent === "ready" || agent === "starting") return "Product Owner";
  return agent
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function agentBackgroundColor(agent: string): string {
  return agentColors[agent] ?? theme.primary;
}

export function formatAgentContext(
  context: AgentContext,
  totalStories: number,
): string {
  return [
    composerAgent(context.agent),
    context.storyId === undefined
      ? undefined
      : `story ${context.storyId}${totalStories ? `/${totalStories}` : ""}`,
    context.iteration === undefined
      ? undefined
      : `iteration ${context.iteration}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

export function formatElapsedTime(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
