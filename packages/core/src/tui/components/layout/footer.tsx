import { formatElapsedTime, spinnerFrames, theme } from "../shared";

type FooterProps = {
  running: boolean;
  progressFrame: number;
  seconds: number;
};

export function Footer(props: FooterProps) {
  return (
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
        {props.running && (
          <text fg={theme.secondary}>
            {spinnerFrames[props.progressFrame] ?? spinnerFrames[0]}
          </text>
        )}
        <text fg={theme.muted}>
          {props.running ? "esc cancel" : "esc quit"}
        </text>
      </box>
      <text fg={props.running ? theme.success : theme.muted}>
        {formatElapsedTime(props.seconds)}
      </text>
    </box>
  );
}
