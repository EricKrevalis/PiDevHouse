import { Config } from "./modules/model/config.model.ts";
import { TerminalView } from "./modules/ui/terminalView.ts";
import { runWorkflow } from "./runtime/workflow.ts";

const envPath = new URL("../../../.env", import.meta.url).pathname;
try {
  process.loadEnvFile(envPath);
} catch {
  // no .env file
}

const args = process.argv.slice(2);
if (args.length === 0) {
  await import("./api/server.ts");
} else {
  TerminalView.getInstance();
  try {
    process.exit((await runWorkflow(Config.fromArgs(args))) ? 1 : 0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
