import { Config } from "../modules/model/config.model.ts";
import { runWorkflow } from "../runtime/workflow.ts";

const PORT = Number(Deno.env.get("PIDEV_PORT") ?? 8765);
const clients = new Set<WebSocket>();
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve({ hostname: "127.0.0.1", port: PORT }, (req) => {
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    clients.add(socket);
    socket.onclose = () => clients.delete(socket);
    return response;
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method === "POST" && new URL(req.url).pathname === "/runs") {
    req
      .json()
      .then((body) => {
        return runWorkflow(Config.from({ request: body.request }));
      })
      .catch(console.error);
    return new Response(null, { status: 202, headers: CORS });
  }
  return new Response("Not Found", { status: 404 });
});

export function broadcast(message: string): void {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
