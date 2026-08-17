import { useKeyboard } from "@opentui/solid";
import { For } from "solid-js";
import { TerminalState } from "./terminalState.ts";

export function TerminalScreen({ terminal }: { terminal: TerminalState }) {
  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") terminal.cancel();
  });

  return (
    <box height="100%" flexDirection="column">
      <scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom">
        <text>
          <For each={terminal.output}>
            {(segment) => (
              <span style={{ fg: segment.color } as never}>
                {segment.content}
              </span>
            )}
          </For>
        </text>
        <text>
          <span style={{ fg: "cyan" } as never}>{terminal.thinkingLabel}</span>
          {terminal.thinkingFrame}
        </text>
      </scrollbox>
      <box height={1} flexDirection="row" justifyContent="flex-end">
        <text fg="cyan" content={terminal.elapsed} />
      </box>
    </box>
  );
}
