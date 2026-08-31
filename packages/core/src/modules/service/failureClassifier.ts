import type { Summary } from "../model/summary.model.ts";

// splits a failed run by who failed. the completion rate mixes a model that
// could not solve the story with a hung command or an unreachable host, and a
// mixed rate cannot answer whether a model configuration is better.

export type FailureClass =
  | "none"
  | "model"
  | "agent_timeout"
  | "tool_hang"
  | "provider"
  | "cancelled"
  | "unknown";

// a tool call at or past the bash default ran until something killed it.
const TOOL_HANG_MS = 300_000;

// the classes that say the harness or the environment failed, not the model.
// a run in one of these is not evidence about the model that produced it.
const INFRASTRUCTURE: ReadonlySet<FailureClass> = new Set<FailureClass>([
  "tool_hang",
  "provider",
  "unknown",
]);

export function classifyFailure(summary: Summary | null): FailureClass {
  // no summary means the run died before it could describe itself.
  if (summary === null) return "unknown";
  if (summary.outcome === "completed") return "none";
  if (summary.outcome === "cancelled" || summary.failureMode === "cancelled") {
    return "cancelled";
  }

  const agents = Object.values(summary.agents);
  // a hung command holds the whole invocation, so it outranks the timeout it
  // caused: the timeout is the symptom, the hang is the cause.
  if (agents.some((usage) => usage.longestToolCallMs >= TOOL_HANG_MS)) {
    return "tool_hang";
  }
  // an invocation that ran out the budget with no hung command spent that time
  // in the model. that is model behaviour, not infrastructure.
  if (agents.some((usage) => usage.timedOutInvocations > 0)) {
    return "agent_timeout";
  }
  if (summary.outcome === "error") return "provider";
  return "model";
}

export function isInfrastructureFailure(failureClass: FailureClass): boolean {
  return INFRASTRUCTURE.has(failureClass);
}

// a run whose outcome is attributable to the model, so its duration and token
// figures are comparable with other runs of the same variant.
export function isValidRun(summary: Summary | null): boolean {
  const failureClass = classifyFailure(summary);
  return !isInfrastructureFailure(failureClass) && failureClass !== "cancelled";
}
