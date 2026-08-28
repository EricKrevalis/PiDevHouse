import {
  render,
  useKeyboard,
  useRenderer,
  useSelectionHandler,
} from "@opentui/solid";
import {
  createComponent,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { main } from "../runtime/workflow";
import type { Message } from "../modules/models/message.model";
import {
  limitActivityEntries,
  reduceActivity,
  type ActivityEntry,
} from "./activity";
import { formatElapsedTime, spinnerFrames } from "./components/shared";
import {
  tuiView,
  type AgentContext,
  type InputElement,
} from "./components/layout/tuiView";

export type TuiRunner = (
  request: string,
  onMessage: (message: Message) => void,
  signal: AbortSignal,
  onStatus?: (status: string) => void,
  onElapsed?: (seconds: number) => void,
) => Promise<boolean>;

type AppProps = {
  run?: TuiRunner;
  initialRequest?: string;
  signal?: AbortSignal;
};

const defaultRun: TuiRunner = (request, onMessage, signal) =>
  main(request, onMessage, signal);

export const App = (props: AppProps = {}) => {
  const renderer = useRenderer();
  const [activity, setActivity] = createSignal<ActivityEntry[]>([]);
  const [seconds, setSeconds] = createSignal(0);
  const [running, setRunning] = createSignal(false);
  const [thinking, setThinking] = createSignal(false);
  const [progressFrame, setProgressFrame] = createSignal(0);
  const [currentContext, setCurrentContext] = createSignal<AgentContext>({
    agent: "ready",
  });
  const [totalStories, setTotalStories] = createSignal(0);
  const [inputEl, setInputEl] = createSignal<InputElement>();
  let runController: AbortController | undefined;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let runStartedAt = 0;
  const run = props.run ?? defaultRun;
  const updateActivity = (
    update: (entries: ActivityEntry[]) => ActivityEntry[],
  ) => setActivity((entries) => limitActivityEntries(update(entries)));
  const showElapsed = (totalSeconds: number) => {
    setSeconds(totalSeconds);
    updateActivity((prev) => [
      ...prev,
      {
        type: "text",
        text: `total elapsed · ${formatElapsedTime(totalSeconds)}`,
      },
      { type: "text", text: "" },
    ]);
  };

  useKeyboard((key) => {
    if (key.name !== "escape") return;
    if (runController) runController.abort();
    else renderer.destroy();
  });
  useSelectionHandler((selection) => {
    const text = selection.getSelectedText();
    if (!text) return;
    renderer.copyToClipboardOSC52(text);
    renderer.clearSelection();
  });
  onCleanup(() => {
    runController?.abort();
    if (focusTimer !== undefined) clearTimeout(focusTimer);
  });

  createEffect(() => {
    if (!running()) return;
    const timer = setInterval(
      () => setProgressFrame((frame) => (frame + 1) % spinnerFrames.length),
      100,
    );
    onCleanup(() => clearInterval(timer));
  });

  const onSubmit = (value: unknown) => {
    const request = String(value).trim();
    if (!request || running()) return;
    updateActivity((prev) => [
      ...prev,
      { type: "text", text: `› ${request}` },
      { type: "text", text: "" },
    ]);
    setSeconds(0);
    runStartedAt = Date.now();
    setRunning(true);
    setCurrentContext({ agent: "starting" });
    setProgressFrame(0);
    const el = inputEl();
    if (el) el.value = "";
    const controller = new AbortController();
    runController = controller;
    const signal = props.signal
      ? AbortSignal.any([props.signal, controller.signal])
      : controller.signal;
    run(
      request,
      handleMessage,
      signal,
      (status) =>
        updateActivity((prev) => [
          ...prev,
          { type: "text", text: status },
          { type: "text", text: "" },
        ]),
      showElapsed,
    )
      .catch((error) =>
        updateActivity((prev) => [
          ...prev,
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]),
      )
      .finally(() => {
        const totalSeconds = Math.floor((Date.now() - runStartedAt) / 1000);
        showElapsed(totalSeconds);
        runStartedAt = 0;
        if (runController === controller) runController = undefined;
        setRunning(false);
        setThinking(false);
        setCurrentContext({ agent: "ready" });
        if (props.initialRequest) renderer.destroy();
        else {
          focusTimer = setTimeout(() => {
            focusTimer = undefined;
            inputEl()?.focus();
          }, 0);
        }
      });
  };

  onMount(() => {
    if (props.initialRequest) onSubmit(props.initialRequest);
  });

  function handleMessage(msg: Message) {
    if (msg.type === "elapsed") return setSeconds(msg.seconds);
    if (msg.type === "run_info") {
      setTotalStories(msg.totalStories);
    }
    if (msg.type === "thinking_start") {
      setThinking(true);
      return;
    }
    if (
      msg.type === "thinking_end" ||
      msg.type === "text_delta" ||
      msg.type === "agent_end"
    ) {
      setThinking(false);
    }
    if (msg.type === "agent_start" || msg.type === "agent_retry") {
      setCurrentContext({
        agent: msg.agent,
        storyId: msg.storyId,
        iteration: msg.iteration,
      });
    }
    updateActivity((prev) => reduceActivity(prev, msg));
  }

  return createComponent(tuiView, {
    get context() {
      return currentContext();
    },
    get totalStories() {
      return totalStories();
    },
    get activity() {
      return activity();
    },
    get running() {
      return running();
    },
    get thinking() {
      return thinking();
    },
    get progressFrame() {
      return progressFrame();
    },
    get seconds() {
      return seconds();
    },
    inputRef: setInputEl,
    onSubmit,
  });
};

if (import.meta.main) await render(App);
