import { Config } from "../modules/model/config.model.ts";
import { Message, type RunStatus } from "../modules/model/message.model.ts";
import { EventBus, type MessageHandler } from "../modules/service/eventBus.service.ts";
import { runWorkflow } from "../runtime/workflow.ts";

const PORT = Number(process.env.PIDEV_PORT ?? 8765);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const MAX_BUFFER = 2000;

interface RunState {
  request: string;
  startedAt: string;
  status: RunStatus;
  outputDir?: string;
  totalStories?: number;
}

const runs = new Map<string, RunState>();
const buffers = new Map<string, Message[]>();
const subscriptions = new Map<WebSocket, string>();

class RunForwarder implements MessageHandler {
  handle(message: Message): void {
    const buffer = buffers.get(message.runId);
    if (buffer) {
      buffer.push(message);
      if (buffer.length > MAX_BUFFER) buffer.shift();
    }

    if (message.type === "run_info") {
      const run = runs.get(message.runId);
      if (run) run.totalStories = message.totalStories;
    }
    if (message.type === "run_status") {
      const run = runs.get(message.runId);
      if (run && message.status !== "retry") {
        run.status = message.status;
        run.outputDir = message.outputDir ?? run.outputDir;
      }
      if (message.status !== "retry") buffers.delete(message.runId);
    }

    const payload = JSON.stringify(message);
    for (const [socket, runId] of subscriptions) {
      if (socket.readyState === WebSocket.OPEN && runId === message.runId) {
        socket.send(payload);
      }
    }
  }
}

EventBus.getInstance().subscribe(new RunForwarder());

const server: Bun.Server<undefined> = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.headers.get("upgrade") === "websocket") {
      return server.upgrade(req, { data: undefined })
        ? undefined
        : new Response("Upgrade failed", { status: 400 });
    }
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method === "GET" && url.pathname.startsWith("/runs/")) {
      const runId = decodeURIComponent(url.pathname.slice("/runs/".length));
      const run = runs.get(runId);
      return run
        ? new Response(JSON.stringify({ runId, ...run }), {
            headers: { ...CORS, "Content-Type": "application/json" },
          })
        : new Response(null, { status: 404, headers: CORS });
    }
    if (req.method === "POST" && url.pathname === "/runs") {
      try {
        const body = await req.json();
        const runId = crypto.randomUUID();
        runs.set(runId, {
          request: typeof body?.request === "string" ? body.request : "",
          startedAt: new Date().toISOString(),
          status: "running",
        });
        buffers.set(runId, []);
        runWorkflow(Config.from({ request: body?.request }), runId).catch(
          console.error,
        );
        return new Response(JSON.stringify({ runId }), {
          status: 202,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      } catch {
        return new Response("Bad Request", { status: 400, headers: CORS });
      }
    }
    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    message(socket, event) {
      try {
        const frame = JSON.parse(String(event));
        if (frame.type === "subscribe" && typeof frame.runId === "string") {
          const client = socket as unknown as WebSocket;
          subscriptions.set(client, frame.runId);
          for (const message of buffers.get(frame.runId) ?? []) {
            socket.send(JSON.stringify(message));
          }
        }
      } catch {
        // Ignore malformed subscription frames.
      }
    },
    close(socket) {
      subscriptions.delete(socket as unknown as WebSocket);
    },
  },
});
