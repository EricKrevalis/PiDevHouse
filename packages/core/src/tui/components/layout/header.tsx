import { TextAttributes } from "@opentui/core";
import { formatAgentContext, type AgentContext, theme } from "../shared";

type HeaderProps = {
  context: AgentContext;
  totalStories: number;
  running: boolean;
};

export function Header(props: HeaderProps) {
  return (
    <box
      flexShrink={0}
      width="100%"
      height={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      alignItems="center"
    >
      <text
        fg={props.running ? theme.secondary : theme.muted}
        attributes={props.running ? TextAttributes.BOLD : undefined}
      >
        {formatAgentContext(props.context, props.totalStories)}
      </text>
    </box>
  );
}
