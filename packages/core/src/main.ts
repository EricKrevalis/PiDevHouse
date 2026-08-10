import "./api/server.ts";
import { loadSync } from "@std/dotenv";
import { Config } from "./modules/model/config.model.ts";
import { runWorkflow } from "./runtime/workflow.ts";

loadSync({
  envPath: new URL("../../../.env", import.meta.url).pathname,
  export: true,
});

if (Deno.args.length > 0) {
  try {
    Deno.exit((await runWorkflow(Config.fromArgs(Deno.args))) ? 1 : 0);
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}
