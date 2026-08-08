const PORT = Number(Deno.env.get("PIDEV_PORT") ?? 8765);
const clients = new Set<WebSocket>();

Deno.serve({ port: PORT }, (req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("Not Found", { status: 404 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  clients.add(socket);
  socket.onclose = () => clients.delete(socket);
  return response;
});

export function broadcast(message: string): void {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
