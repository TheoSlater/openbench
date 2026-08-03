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
const clients = new Map<string, Set<ServerWebSocket<SocketData>>>();
function send(socket: ServerWebSocket<SocketData>, message: unknown) {
  socket.send(JSON.stringify(message));
}

function close(socket: ServerWebSocket<SocketData>) {
  socket.close(1008, "Pairing rejected");
}

function registerClient(hostId: string, socket: ServerWebSocket<SocketData>) {
  const group = clients.get(hostId) ?? new Set();
  group.add(socket);
  clients.set(hostId, group);
}

function unregisterClient(hostId: string, socket: ServerWebSocket<SocketData>) {
  const group = clients.get(hostId);
  if (!group) return;
  group.delete(socket);
  if (group.size === 0) clients.delete(hostId);
}

function hostFor(socket: ServerWebSocket<SocketData>) {
  return hosts.get(socket.data.hostId ?? "");
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
        const existingPeer = message.role === "host"
          ? undefined
          : hostFor(socket);
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
        if (message.role === "host") {
          hosts.set(message.hostId, socket);
        } else {
          registerClient(message.hostId, socket);
        }

        const peer = message.role === "host"
          ? Array.from(clients.get(message.hostId) ?? [])
          : [hostFor(socket)].filter((p): p is NonNullable<typeof p> => Boolean(p));
        for (const target of peer) {
          if (!target) continue;
          send(socket, { type: "ready", peerPublicKey: target.data.publicKey });
          send(target, { type: "ready", peerPublicKey: message.publicKey });
        }
        return;
      }

      if (message.type !== "frame") {
        close(socket);
        return;
      }
      const peer = socket.data.role === "host"
        ? Array.from(clients.get(socket.data.hostId ?? "") ?? [])
        : hostFor(socket) ? [hostFor(socket)!] : [];
      if (peer.length === 0) {
        send(socket, { type: "error", error: "Host is offline." });
        return;
      }
      const payload = message.payload;
      for (const target of peer) {
        send(target, { type: "frame", payload });
      }
    },
    close(socket) {
      if (socket.data.role === "host") {
        if (socket.data.hostId && hosts.get(socket.data.hostId) === socket) {
          hosts.delete(socket.data.hostId);
        }
      } else if (socket.data.hostId) {
        unregisterClient(socket.data.hostId, socket);
      }
      const peer = socket.data.role === "host"
        ? Array.from(clients.get(socket.data.hostId ?? "") ?? [])
        : socket.data.hostId && hosts.get(socket.data.hostId)
          ? [hosts.get(socket.data.hostId)!]
          : [];
      for (const target of peer) {
        send(target, { type: "peer-disconnected" });
      }
    },
  },
});

console.log("Poly relay listening on ws://0.0.0.0:" + server.port + "/ws");
