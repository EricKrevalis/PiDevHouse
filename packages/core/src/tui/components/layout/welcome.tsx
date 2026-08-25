import { TextAttributes } from "@opentui/core";
import { theme } from "../shared";

export function Welcome() {
  return (
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
  );
}
