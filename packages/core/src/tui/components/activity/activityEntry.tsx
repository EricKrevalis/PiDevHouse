import { TextAttributes } from "@opentui/core";
import type { ActivityEntry } from "../../activity";
import {
  agentBackgroundColor,
  formatAgentContext,
  formatToolArgs,
  lineColor,
  singleLine,
  theme,
  toolColor,
  toolStatus,
} from "../shared";

type ActivityEntryViewProps = {
  entry: ActivityEntry;
  totalStories: number;
  progressFrame: number;
};

export function ActivityEntryView(props: ActivityEntryViewProps) {
  if (props.entry.type === "tool") {
    return (
      <text fg={toolColor(props.entry.status)} wrapMode="none" truncate>
        {props.entry.status === "running"
          ? toolStatus(props.entry.status, props.progressFrame)
          : toolStatus(props.entry.status, 0)} ⚙ {props.entry.tool}
        {formatToolArgs(props.entry.args, props.entry.tool)}
        {props.entry.status === "error" && props.entry.result
          ? ` · ${singleLine(props.entry.result)}`
          : ""}
      </text>
    );
  }

  if (props.entry.type === "agent") {
    return (
      <box
        width="100%"
        height={1}
        paddingLeft={1}
        backgroundColor={agentBackgroundColor(props.entry.agent)}
      >
        <text
          fg={theme.background}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
        >
          {formatAgentContext(
            {
              agent: props.entry.agent,
              storyId: props.entry.storyId,
              iteration: props.entry.iteration,
            },
            props.totalStories,
          ).toUpperCase()}
        </text>
      </box>
    );
  }

  return <text fg={lineColor(props.entry.text)}>{props.entry.text}</text>;
}
