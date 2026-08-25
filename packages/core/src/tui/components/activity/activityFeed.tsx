import { For } from "solid-js";
import type { ActivityEntry } from "../../activity";
import { ActivityEntryView } from "./activityEntry";
import { spinnerFrames, theme } from "../shared";

type ActivityFeedProps = {
  entries: ActivityEntry[];
  thinking: boolean;
  progressFrame: number;
  totalStories: number;
};

export function ActivityFeed(props: ActivityFeedProps) {
  return (
    <scrollbox
      flexGrow={1}
      width="100%"
      paddingTop={1}
      paddingLeft={2}
      paddingRight={2}
      stickyScroll
      stickyStart="bottom"
    >
      <For each={props.entries}>
        {(entry) => (
          <ActivityEntryView
            entry={entry}
            totalStories={props.totalStories}
            progressFrame={props.progressFrame}
          />
        )}
      </For>
      {props.thinking && (
        <text fg={theme.secondary}>
          {spinnerFrames[props.progressFrame] ?? spinnerFrames[0]} Thinking
        </text>
      )}
    </scrollbox>
  );
}
