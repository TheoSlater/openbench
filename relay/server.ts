type SocketData = {
  role: "host" | "client" | "unknown";
  hostId?: string;
  pairingToken?: string;
  publicKey?: string;
};

type RelayMessage =
  | {
      type: "register";
      role: "host" | "client";
      hostId: string;
      pairingToken: string;
      publicKey: string;
    }
  | { type: "frame"; payload: unknown };

const hosts = new Map<string, ServerWebSocket<SocketData>>();
const clients = new Map<string, ServerWebSocket<SocketData>>();
function send(socket: ServerWebSocket<SocketData>, message: unknown) {
  socket.send(JSON.stringify(message));
}

function close(socket: ServerWebSocket<SocketData>) {
  socket.close(1008, "Pairing rejected");
}

function peerFor(socket: ServerWebSocket<SocketData>) {
  return socket.data.role === "host"
    ? clients.get(socket.data.hostId ?? "")
    : hosts.get(socket.data.hostId ?? "");
}

const server = Bun.serve<SocketData>({
  port: Number(Bun.env.PORT ?? 8787),
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("Poly relay online");
    if (server.upgrade(request, { data: { role: "unknown" } })) return;
    return new Response("WebSocket upgrade failed", { status: 400 });
  },
  websocket: {
    open() {},
    message(socket, raw) {
      let message: RelayMessage;
      try {
        message = JSON.parse(String(raw)) as RelayMessage;
      } catch {
        close(socket);
        return;
      }

      if (message.type === "register") {
        if (
          !message.hostId ||
          !message.pairingToken ||
          !message.publicKey
        ) {
          close(socket);
          return;
        }
        if (message.role === "host" && hosts.has(message.hostId)) {
          hosts.get(message.hostId)?.close(1012, "Host reconnected");
        }
        const existingPeer = (message.role === "host" ? clients : hosts).get(message.hostId);
        if (existingPeer && existingPeer.data.pairingToken !== message.pairingToken) {
          close(socket);
          return;
        }
        socket.data = {
          role: message.role,
          hostId: message.hostId,
          pairingToken: message.pairingToken,
          publicKey: message.publicKey,
        };
        (message.role === "host" ? hosts : clients).set(message.hostId, socket);

        const peer = peerFor(socket);
        if (peer) {
          send(socket, { type: "ready", peerPublicKey: peer.data.publicKey });
          send(peer, { type: "ready", peerPublicKey: message.publicKey });
        }
        return;
      }

      if (message.type !== "frame") {
        close(socket);
        return;
      }
      const peer = peerFor(socket);
      if (!peer) {
        send(socket, { type: "error", error: "Host is offline." });
        return;
      }
      send(peer, { type: "frame", payload: message.payload });
    },
    close(socket) {
      const map = socket.data.role === "host" ? hosts : clients;
      if (socket.data.hostId && map.get(socket.data.hostId) === socket) {
        map.delete(socket.data.hostId);
      }
      const peer = socket.data.hostId ? peerFor(socket) : undefined;
      if (peer) send(peer, { type: "peer-disconnected" });
    },
  },
});

console.log("Poly relay listening on ws://0.0.0.0:" + server.port + "/ws");
