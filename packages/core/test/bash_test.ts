import { resolve } from "node:path";
import { sandboxCommand } from "../src/tools/bash.ts";

Deno.test("bash cannot read the run log outside its workspace", async () => {
  const runDir = await Deno.makeTempDir();
  const cwd = resolve(runDir, "workspace");
  await Deno.mkdir(cwd);
  await Deno.writeTextFile(resolve(runDir, "outputlog.jsonl"), "secret");

  try {
    const command = sandboxCommand(
      cwd,
      "test ! -e ../outputlog.jsonl && touch allowed",
    );
    const result = await new Deno.Command("bash", {
      args: ["-lc", command],
    }).output();

    if (!result.success) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
    await Deno.stat(resolve(cwd, "allowed"));
  } finally {
    await Deno.remove(runDir, { recursive: true });
  }
});
