import {
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { Logger } from "../models/logger.ts";
import type { RunTimer } from "../models/timer.ts";
import type { Workspace } from "../models/workspace.ts";

const textEncoder = new TextEncoder();

export function writeOutput(message: string): void {
  Deno.stdout.writeSync(textEncoder.encode(message));
}

export function writeStatus(message: string): void {
  Deno.stderr.writeSync(textEncoder.encode(message));
}

function formatToolDetails(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";

  const values = args as Record<string, unknown>;
  if (toolName === "bash" && typeof values.command === "string") {
    const command =
      values.command.slice(0, 500) + (values.command.length > 500 ? "..." : "");
    return `\n  $ ${command}`;
  }

  const path = values.path ?? values.file_path;
  return path ? `\n  path: ${path}` : "";
}

function formatError(result: unknown): string {
  const message =
    typeof result === "string"
      ? result
      : (JSON.stringify(result) ?? String(result));
  return message.slice(0, 500) + (message.length > 500 ? "..." : "");
}

export function attachLogger(
  session: AgentSession,
  workspace: Workspace,
  statusPrefix: () => string,
  agentName: string,
  timer: RunTimer,
  story?: number,
  iteration?: number,
): Logger {
  let pendingLogWrite: Promise<void> = Promise.resolve();
  let response = "";
  let responseStarted = false;

  const writeLog = (entry: object) => {
    pendingLogWrite = pendingLogWrite.then(() =>
      Deno.writeTextFile(
        resolve(workspace.logDir, "outputlog.jsonl"),
        `${JSON.stringify({
          ...entry,
          elapsedMs: timer.elapsedMs(),
          agentName,
          story,
          iteration,
        })}\n`,
        { append: true },
      ),
    );
  };

  writeLog({ type: "agent_started" });

  session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") response = "";
        break;
      case "message_update":
        if (event.assistantMessageEvent.type !== "text_delta") break;
        if (!responseStarted) {
          writeOutput(`\n${statusPrefix()}${agentName} response:\n\n`);
          responseStarted = true;
        }
        response += event.assistantMessageEvent.delta;
        writeOutput(event.assistantMessageEvent.delta);
        break;
      case "message_end":
        if (event.message.role === "assistant" && response) {
          writeLog({ type: "assistant_response", text: response });
        }
        break;
      case "tool_execution_start":
        writeLog({ type: "tool_execution", toolName: event.toolName });
        writeStatus(
          `\n${statusPrefix()}[${agentName}] [tool]: ${event.toolName}${formatToolDetails(
            event.toolName,
            event.args,
          )}\n`,
        );
        break;
      case "tool_execution_end":
        if (event.isError) {
          writeLog({
            type: "tool_error",
            toolName: event.toolName,
            error: formatError(event.result),
          });
        }
        break;
    }
  });

  return {
    response: () => response,
    complete: () => writeLog({ type: "agent_completed" }),
    fail: (error: unknown) =>
      writeLog({ type: "agent_failed", error: formatError(error) }),
    flush: () => pendingLogWrite,
  };
}
