import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Path } from "typescript";
import { resolve } from "node:path";
import { run } from "../runtime/workflow";
import type { Config } from "../modules/models/config.model";
import type { Message } from "../modules/models/message.model";

const theme = {
  background: "#24273a",
  panel: "#1e2030",
  element: "#363a4f",
  text: "#cad3f5",
  muted: "#8087a2",
  primary: "#c6a0f6",
  secondary: "#f5bde6",
  info: "#8bd5ca",
  success: "#a6da95",
  warning: "#eed49f",
  error: "#ed8796",
} as const;

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const modelLabel = process.env.OLLAMA_MODEL ?? "ollama";
type ToolStatus = "running" | "done" | "error";

type LogEntry =
  | { type: "text"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      tool: string;
      args?: Record<string, unknown>;
      status: ToolStatus;
      result?: string;
    };

const config: Config = {
  outputDir: resolve("runs") as Path,
  maxIteration: 3,
  minScore: 60,
  maxToolCalls: 100,
  runTimeoutSeconds: 30 * 60,
};

const App = () => {
  const renderer = useRenderer();
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [seconds, setSeconds] = createSignal(0);
  const [running, setRunning] = createSignal(false);
  const [thinking, setThinking] = createSignal(false);
  const [progressFrame, setProgressFrame] = createSignal(0);
  const [currentAgent, setCurrentAgent] = createSignal("ready");
  const [inputEl, setInputEl] = createSignal<{
    value: string;
    focus: () => void;
  }>();
  let runController: AbortController | undefined;

  useKeyboard((key) => {
    if (key.name !== "escape") return;
    if (runController) runController.abort();
    else renderer.destroy();
  });
  onCleanup(() => runController?.abort());

  createEffect(() => {
    if (!running()) return;
    const timer = setInterval(
      () => setProgressFrame((frame) => (frame + 1) % spinnerFrames.length),
      80,
    );
    onCleanup(() => clearInterval(timer));
  });

  const onSubmit = (value: unknown) => {
    const request = String(value).trim();
    if (!request || running()) return;
    setLogs((prev) => [
      ...prev,
      { type: "text", text: `› ${request}` },
      { type: "text", text: "" },
    ]);
    setSeconds(0);
    setRunning(true);
    setCurrentAgent("starting");
    setProgressFrame(0);
    const el = inputEl();
    if (el) el.value = "";
    const controller = new AbortController();
    runController = controller;
    run(config, request, handleMessage, controller.signal)
      .catch((error) =>
        setLogs((prev) => [
          ...prev,
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]),
      )
      .finally(() => {
        if (runController === controller) runController = undefined;
        setRunning(false);
        setThinking(false);
        setCurrentAgent("ready");
        setTimeout(() => inputEl()?.focus(), 0);
      });
  };

  const handleMessage = (msg: Message) => {
    if (msg.type === "elapsed") return setSeconds(msg.seconds);
    if (msg.type === "thinking_start") {
      setThinking(true);
      return;
    }
    if (
      msg.type === "thinking_end" ||
      msg.type === "text_delta" ||
      msg.type === "agent_end"
    ) {
      setThinking(false);
    }
    if (msg.type === "agent_start") setCurrentAgent(msg.agent);
    setLogs((prev) => renderMessage(prev, msg));
  };

  return (
    <box
      flexDirection="column"
      height="100%"
      backgroundColor={theme.background}
    >
      <box
        flexShrink={0}
        width="100%"
        height={1}
        flexDirection="row"
        alignItems="center"
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          Concentus
        </text>
        <text fg={theme.muted}>/</text>
        <text fg={running() ? theme.secondary : theme.muted}>
          {currentAgent()}
        </text>
      </box>
      {logs().length === 0 ? (
        <box
          flexGrow={1}
          width="100%"
          alignItems="center"
          flexDirection="column"
        >
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            Concentus
          </text>
          <text fg={theme.text}>What should we build?</text>
        </box>
      ) : (
        <scrollbox
          flexGrow={1}
          width="100%"
          paddingTop={1}
          paddingLeft={2}
          paddingRight={2}
          stickyScroll
          stickyStart="bottom"
        >
          {logs().map((entry) =>
            entry.type === "tool" ? (
              <text fg={toolColor(entry.status)}>
                {toolStatus(entry.status, progressFrame())} ⚙ {entry.tool}
                {formatToolArgs(entry.args)}
                {entry.status === "error" && entry.result
                  ? ` · ${singleLine(entry.result)}`
                  : ""}
              </text>
            ) : (
              <text fg={lineColor(entry.text)}>{entry.text}</text>
            ),
          )}
          {thinking() && (
            <text fg={theme.secondary}>
              {spinnerFrames[progressFrame()] ?? spinnerFrames[0]} Thinking
            </text>
          )}
        </scrollbox>
      )}
      {!running() && (
        <box
          flexShrink={0}
          marginLeft={2}
          marginRight={2}
          border={["left"]}
          borderColor={theme.primary}
        >
          <box
            flexDirection="column"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            gap={1}
            backgroundColor={theme.element}
            justifyContent="center"
          >
            <input
              ref={setInputEl}
              focused
              width="100%"
              placeholder="Ask anything..."
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={theme.text}
              backgroundColor={theme.element}
              focusedBackgroundColor={theme.element}
              onSubmit={onSubmit}
            />
            <box flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
              <text fg={theme.primary}>{composerAgent(currentAgent())}</text>
              <text fg={theme.muted}>·</text>
              <text fg={theme.text}>{modelLabel}</text>
            </box>
          </box>
        </box>
      )}
      <box
        flexShrink={0}
        width="100%"
        height={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <box flexDirection="row" alignItems="center" gap={1}>
          {running() && (
            <text fg={theme.secondary}>
              {spinnerFrames[progressFrame()] ?? spinnerFrames[0]}
            </text>
          )}
          <text fg={theme.muted}>{running() ? "esc cancel" : "esc quit"}</text>
        </box>
        <text fg={running() ? theme.success : theme.muted}>
          {fmtTime(seconds())}
        </text>
      </box>
    </box>
  );
};

function lineColor(line: string): string {
  if (line.startsWith("› ")) return theme.primary;
  if (/^(productOwner|developer|reviewer|tester)(?: ·|$)/.test(line)) {
    return theme.secondary;
  }
  if (line.startsWith("retry ·")) return theme.warning;
  if (line.startsWith("warning ·")) return theme.warning;
  if (line.startsWith("score ")) return theme.warning;
  if (line.startsWith("run ")) return theme.muted;
  return theme.text;
}

function toolStatus(status: ToolStatus, frame: number): string {
  if (status === "running") {
    return spinnerFrames[frame] ?? spinnerFrames[0] ?? "⋯";
  }
  return status === "error" ? "✗" : "✓";
}

function toolColor(status: ToolStatus): string {
  if (status === "running") return theme.info;
  return status === "error" ? theme.error : theme.muted;
}

function formatToolArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const values = Object.entries(args).filter(([, value]) =>
    ["string", "number", "boolean"].includes(typeof value),
  );
  if (values.length === 0) return "";
  return ` [${values
    .map(
      ([key, value]) =>
        `${key}=${typeof value === "string" ? JSON.stringify(value) : value}`,
    )
    .join(", ")}]`;
}

function singleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function composerAgent(agent: string): string {
  if (agent === "ready" || agent === "starting") return "Product Owner";
  return agent
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function renderMessage(prev: LogEntry[], msg: Message): LogEntry[] {
  switch (msg.type) {
    case "text_delta":
      const last = prev.at(-1);
      if (!last || last.type !== "text") {
        return [...prev, { type: "text", text: msg.delta }];
      }
      return [
        ...prev.slice(0, -1),
        { type: "text", text: last.text + msg.delta },
      ];
    case "text_end":
      return [...prev, { type: "text", text: "" }];
    case "warning":
      return [...prev, { type: "text", text: `warning · ${msg.message}` }];
    case "agent_start":
      return [
        ...prev,
        {
          type: "text",
          text: [
            msg.agent,
            msg.storyId === undefined ? undefined : `story #${msg.storyId}`,
            msg.iteration === undefined
              ? undefined
              : `iteration ${msg.iteration}`,
          ]
            .filter((part): part is string => part !== undefined)
            .join(" · "),
        },
        { type: "text", text: "" },
      ];
    case "agent_retry":
      return [
        ...prev,
        {
          type: "text",
          text: [
            "retry",
            msg.agent,
            msg.storyId === undefined ? undefined : `story #${msg.storyId}`,
            msg.iteration === undefined
              ? undefined
              : `iteration ${msg.iteration}`,
            msg.message,
          ]
            .filter((part): part is string => part !== undefined)
            .join(" · "),
        },
        { type: "text", text: "" },
      ];
    case "tool_start":
      return [
        ...prev,
        {
          type: "tool",
          toolCallId: msg.toolCallId,
          tool: msg.tool,
          args: msg.args,
          status: "running",
        },
      ];
    case "tool_end": {
      const index = prev.findLastIndex(
        (entry) => entry.type === "tool" && entry.toolCallId === msg.toolCallId,
      );
      if (index === -1) {
        return [
          ...prev,
          {
            type: "tool",
            toolCallId: msg.toolCallId,
            tool: msg.tool,
            status: msg.isError ? "error" : "done",
            result: msg.result,
          },
        ];
      }
      return prev.map((entry, entryIndex) =>
        entryIndex === index && entry.type === "tool"
          ? {
              ...entry,
              status: msg.isError ? "error" : "done",
              result: msg.result,
            }
          : entry,
      );
    }
    case "story_score":
      return [
        ...prev,
        {
          type: "text",
          text: `score story #${msg.storyId} · ${msg.variant}  ${msg.score}`,
        },
      ];
    case "run_info":
      return [
        ...prev,
        { type: "text", text: `run stories: ${msg.totalStories}` },
      ];
    case "thinking_start":
    case "thinking_end":
    case "elapsed":
      return prev;
    default:
      return prev;
  }
}

function fmtTime(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

await render(App);
