import "./api/server.ts";
import { runWorkflow } from "./runtime/workflow.ts";

Deno.exit(await runWorkflow());
