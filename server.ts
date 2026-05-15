import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  const server = createServer(app);
  const io = new Server(server, { path: "/socket.io" });

  io.on("connection", (socket) => {
    // Note: in a proxy env, "x-forwarded-for" contains the real client IP.
    const rawIp = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
    const clientIp = Array.isArray(rawIp) ? rawIp[0] : rawIp.split(',')[0];
    
    socket.join(clientIp);

    socket.on("register_client", (data) => {
       const room = data?.online ? "GLOBAL_ONLINE" : clientIp;
       socket.join(room);
       socket.data = { isHost: false, name: data?.name || 'Unknown Device', id: socket.id, room };
       io.to(room).emit("client_list_update", getClientsInRoom(room));
    });

    socket.on("register_host", (data) => {
       const room = data?.online ? "GLOBAL_ONLINE" : clientIp;
       socket.join(room);
       socket.data = { isHost: true, name: data.name, id: socket.id, room, game: data.game };
       io.to(room).emit("client_list_update", getClientsInRoom(room));
    });

    socket.on("get_clients", (data) => {
       const room = data?.online ? "GLOBAL_ONLINE" : clientIp;
       socket.emit("client_list_update", getClientsInRoom(room));
    });
    
    // Host requests a specific client by socket ID
    socket.on("host_request_client", (data) => {
       const { clientId, hostName } = data;
       io.to(clientId).emit("host_request", { hostId: socket.id, hostName });
    });
    
    // Client accepts the host request
    socket.on("client_accept_request", (data) => {
       const { hostId, joinerName } = data;
       io.to(hostId).emit("client_accepted", { clientId: socket.id, joinerName });
    });

    // Client rejects
    socket.on("client_reject_request", (data) => {
       const { hostId } = data;
       io.to(hostId).emit("client_rejected", { clientId: socket.id });
    });
    
    // WebRTC signaling via direct socket messages
    // Host sends offer
    socket.on("send_offer", (data) => {
       const { targetId, sdp } = data;
       io.to(targetId).emit("receive_offer", { sourceId: socket.id, sdp });
    });
    
    // Client sends answer
    socket.on("send_answer", (data) => {
       const { targetId, sdp } = data;
       io.to(targetId).emit("receive_answer", { sourceId: socket.id, sdp });
    });

    socket.on('disconnect', () => {
       const room = socket.data?.room || clientIp;
       io.to(room).emit("client_list_update", getClientsInRoom(room));
    });
  });
  
  function getClientsInRoom(roomIp) {
      if (!io.sockets.adapter.rooms.get(roomIp)) return [];
      const clients = Array.from(io.sockets.adapter.rooms.get(roomIp));
      return clients
        .map(id => io.sockets.sockets.get(id))
        .filter(s => s && s.data)
        .map(s => ({ id: s.id, isHost: s.data.isHost, name: s.data.name }));
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
