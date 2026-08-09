import "./api/server.ts";
import { runWorkflow } from "./runtime/workflow.ts";

try {
  Deno.exit(await runWorkflow());
} catch (error) {
  console.error(error);
  Deno.exit(1);
}
