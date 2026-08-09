import "./api/server.ts";
import { Config } from "./modules/model/config.model.ts";
import { runWorkflow } from "./runtime/workflow.ts";

try {
  Deno.exit((await runWorkflow(Config.fromArgs(Deno.args))) ? 0 : 1);
} catch (error) {
  console.error(error);
  Deno.exit(1);
}
