import { createApplicationContext } from "./application.ts";
import { ApiServer } from "./api/server.ts";
import { Config } from "./modules/model/config.model.ts";
import { TerminalView } from "./modules/ui/terminalView.tsx";

const envPath = new URL("../../../.env", import.meta.url).pathname;
try {
  process.loadEnvFile(envPath);
} catch {
  // no .env file
}

const args = process.argv.slice(2);
const application = createApplicationContext();

if (args.length === 0) {
  const server = new ApiServer({
    eventBus: application.eventBus,
    workflowRunner: application.workflowService,
    port: Number(process.env.PIDEV_PORT ?? 8765),
  });
  server.start();

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await server.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} else {
  const terminalView = await TerminalView.create({
    eventBus: application.eventBus,
  });
  const cancel = (): void => terminalView.cancel();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    process.exitCode = (await application.workflowService.run(
      Config.fromArgs(args),
      undefined,
      terminalView.signal,
    ))
      ? 1
      : 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await terminalView.close();
  }
}
