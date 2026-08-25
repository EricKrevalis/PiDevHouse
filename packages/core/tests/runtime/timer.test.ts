import { expect, test } from "bun:test";
import { startTimer } from "../../src/runtime/timer";

test("stops publishing elapsed time after disposal", async () => {
  let calls = 0;
  const stop = startTimer({ publish: () => calls++ } as never);
  stop();
  await Bun.sleep(1_050);
  expect(calls).toBe(0);
});
