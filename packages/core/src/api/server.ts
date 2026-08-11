import { Config } from "../modules/model/config.model.ts";
import { Message, type RunStatus } from "../modules/model/message.model.ts";
import type { WorkflowRunner } from "../modules/model/workflowRunner.model.ts";
import {
  EventBus,
  type MessageSubscriber,
} from "../modules/service/eventBus.service.ts";
import { WorkflowService } from "../runtime/workflow.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const MAX_BUFFER = 2000;
const SHUTDOWN_GRACE_PERIOD_MS = 10_000;

interface RunState {
  request: string;
  startedAt: string;
  status: RunStatus;
  outputDir?: string;
  totalStories?: number;
  finalMessage?: Extract<Message, { type: "run_status" }>;
}

type ApiServerOptions = {
  eventBus: EventBus;
  workflowRunner: WorkflowRunner;
  port: number;
  shutdownGracePeriodMs?: number;
};

export class ApiServer implements MessageSubscriber {
  private readonly runs = new Map<string, RunState>();
  private readonly buffers = new Map<string, Message[]>();
  private readonly subscriptions = new Map<WebSocket, string>();
  private readonly activeWorkflows = new Map<
    Promise<boolean>,
    AbortController
  >();
  private readonly eventBus: EventBus;
  private readonly workflowRunner: WorkflowRunner;
  private readonly port: number;
  private readonly shutdownGracePeriodMs: number;
  private server: Bun.Server<undefined> | undefined;
  private acceptingRuns = false;

  constructor(options: ApiServerOptions) {
    this.eventBus = options.eventBus;
    this.workflowRunner = options.workflowRunner;
    this.port = options.port;
    this.shutdownGracePeriodMs =
      options.shutdownGracePeriodMs ?? SHUTDOWN_GRACE_PERIOD_MS;
  }

  get listeningPort(): number {
    return this.server?.port ?? this.port;
  }

  start(): void {
    if (this.server !== undefined) return;
    this.acceptingRuns = true;
    this.eventBus.subscribe(this);

    try {
      this.server = Bun.serve({
        hostname: "127.0.0.1",
        port: this.port,
        fetch: (request) => this.handleRequest(request),
        websocket: {
          message: (socket, event) =>
            this.handleWebSocketMessage(socket, event),
          close: (socket) => this.handleWebSocketClose(socket),
        },
      });
    } catch (error) {
      this.eventBus.unsubscribe(this);
      this.acceptingRuns = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.acceptingRuns = false;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    const shutdownTimeout = new Promise<void>((resolve) => {
      shutdownTimer = setTimeout(resolve, this.shutdownGracePeriodMs);
    });
    try {
      // ponytail: bounded shutdown wait; add hard cancellation if this remains insufficient
      const workflows = [...this.activeWorkflows.keys()];
      await Promise.race([Promise.allSettled(workflows), shutdownTimeout]);
      if (this.activeWorkflows.size > 0) {
        for (const controller of this.activeWorkflows.values()) {
          controller.abort(new Error("API server shutting down"));
        }
        let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
        const cancellationTimeout = new Promise<void>((resolve) => {
          cancellationTimer = setTimeout(resolve, this.shutdownGracePeriodMs);
        });
        try {
          await Promise.race([
            Promise.allSettled([...this.activeWorkflows.keys()]),
            cancellationTimeout,
          ]);
        } finally {
          if (cancellationTimer !== undefined) clearTimeout(cancellationTimer);
        }
      }
    } finally {
      if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
    }
    this.eventBus.unsubscribe(this);
    this.subscriptions.clear();

    const server = this.server;
    this.server = undefined;
    if (server !== undefined) await server.stop(true);
  }

  handle(message: Message): void {
    const buffer = this.buffers.get(message.runId);
    if (buffer) {
      buffer.push(message);
      if (buffer.length > MAX_BUFFER) buffer.shift();
    }

    if (message.type === "run_info") {
      const run = this.runs.get(message.runId);
      if (run) run.totalStories = message.totalStories;
    }
    if (message.type === "run_status") {
      const run = this.runs.get(message.runId);
      if (run && message.status !== "retry") {
        run.status = message.status;
        run.outputDir = message.outputDir ?? run.outputDir;
        run.finalMessage = message;
        this.buffers.delete(message.runId);
      }
    }

    const payload = JSON.stringify(message);
    for (const [socket, runId] of this.subscriptions) {
      if (socket.readyState === WebSocket.OPEN && runId === message.runId) {
        socket.send(payload);
      }
    }
  }

  private async handleRequest(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url);

    if (req.headers.get("upgrade") === "websocket") {
      const server = this.server;
      return server?.upgrade(req, { data: undefined })
        ? undefined
        : new Response("Upgrade failed", { status: 400 });
    }
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method === "GET" && url.pathname.startsWith("/runs/")) {
      const runId = decodeURIComponent(url.pathname.slice("/runs/".length));
      const run = this.runs.get(runId);
      return run
        ? new Response(JSON.stringify({ runId, ...run }), {
            headers: { ...CORS, "Content-Type": "application/json" },
          })
        : new Response(null, { status: 404, headers: CORS });
    }
    if (req.method === "POST" && url.pathname === "/runs") {
      if (!this.acceptingRuns) {
        return new Response("Server is shutting down", {
          status: 503,
          headers: CORS,
        });
      }
      try {
        const body = await req.json();
        if (!this.acceptingRuns) {
          return new Response("Server is shutting down", {
            status: 503,
            headers: CORS,
          });
        }
        const runId = crypto.randomUUID();
        const request = typeof body?.request === "string" ? body.request : "";
        this.runs.set(runId, {
          request,
          startedAt: new Date().toISOString(),
          status: "running",
        });
        this.buffers.set(runId, []);
        this.launchWorkflow(Config.from({ request }), runId);
        return new Response(JSON.stringify({ runId }), {
          status: 202,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      } catch {
        return new Response("Bad Request", { status: 400, headers: CORS });
      }
    }
    return new Response("Not Found", { status: 404 });
  }

  private launchWorkflow(config: Config, runId: string): void {
    const controller = new AbortController();
    const workflow = this.workflowRunner.run(config, runId, controller.signal);
    this.activeWorkflows.set(workflow, controller);
    void workflow
      .catch(console.error)
      .finally(() => this.activeWorkflows.delete(workflow));
  }

  private handleWebSocketMessage(
    socket: Bun.ServerWebSocket<undefined>,
    event: string | Buffer,
  ): void {
    try {
      const frame = JSON.parse(String(event));
      if (frame.type === "subscribe" && typeof frame.runId === "string") {
        const client = socket as unknown as WebSocket;
        this.subscriptions.set(client, frame.runId);
        for (const message of this.buffers.get(frame.runId) ?? []) {
          socket.send(JSON.stringify(message));
        }
        const run = this.runs.get(frame.runId);
        if (run?.finalMessage) {
          socket.send(JSON.stringify(run.finalMessage));
        }
      }
    } catch {
      // Ignore malformed subscription frames.
    }
  }

  private handleWebSocketClose(socket: Bun.ServerWebSocket<undefined>): void {
    this.subscriptions.delete(socket as unknown as WebSocket);
  }
}
