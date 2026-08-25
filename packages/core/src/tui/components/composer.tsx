import {
  composerAgent,
  modelLabel,
  theme,
  type InputElement,
} from "./shared";

type ComposerProps = {
  inputRef: (element: InputElement | undefined) => void;
  onSubmit: (value: unknown) => void;
  agent: string;
};

export function Composer(props: ComposerProps) {
  return (
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
          ref={props.inputRef}
          focused
          width="100%"
          placeholder="Ask anything..."
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
          backgroundColor={theme.element}
          focusedBackgroundColor={theme.element}
          onSubmit={props.onSubmit}
        />
        <box flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
          <text fg={theme.primary}>{composerAgent(props.agent)}</text>
          <text fg={theme.muted}>·</text>
          <text fg={theme.text}>{modelLabel}</text>
        </box>
      </box>
    </box>
  );
}
