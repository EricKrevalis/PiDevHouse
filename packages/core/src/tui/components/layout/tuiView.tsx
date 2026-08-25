import { ActivityFeed } from "../activity/activityFeed";
import { Composer } from "../composer";
import { Footer } from "./footer";
import { Header } from "./header";
import { Welcome } from "./welcome";
import { theme, type ViewProps } from "../shared";

export type {
  AgentContext,
  InputElement,
  ViewProps,
} from "../shared";

export function tuiView(props: ViewProps) {
  return (
    <box
      flexDirection="column"
      height="100%"
      backgroundColor={theme.background}
    >
      <Header
        context={props.context}
        totalStories={props.totalStories}
        running={props.running}
      />
      {props.activity.length === 0 ? (
        <Welcome />
      ) : (
        <ActivityFeed
          entries={props.activity}
          thinking={props.thinking}
          progressFrame={props.progressFrame}
          totalStories={props.totalStories}
        />
      )}
      {!props.running && (
        <Composer
          inputRef={props.inputRef}
          onSubmit={props.onSubmit}
          agent={props.context.agent}
        />
      )}
      <Footer
        running={props.running}
        progressFrame={props.progressFrame}
        seconds={props.seconds}
      />
    </box>
  );
}
