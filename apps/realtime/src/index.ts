import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { env } from "@volari/config";
import { checkDatabase, checkRedis, disconnect } from "@volari/db";
import { IslandRoom } from "./rooms/IslandRoom.js";

// Plain HTTP handler for health probes; Colyseus shares this server for WS.
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";

  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ status: "ok", service: "realtime", time: new Date().toISOString() }),
    );
    return;
  }

  if (url === "/health/ready") {
    void Promise.all([checkDatabase(), checkRedis()]).then(([db, redis]) => {
      const ready = db === "up" && redis === "up";
      res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: ready ? "ready" : "degraded",
          service: "realtime",
          deps: { db, redis },
        }),
      );
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Authoritative island room (Phase 2). Players join here; movement is
// validated and integrated server-side.
gameServer.define("island", IslandRoom);

gameServer
  .listen(env.REALTIME_PORT)
  .then(() => console.log(`Volari realtime listening on :${env.REALTIME_PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await gameServer.gracefullyShutdown(false);
    await disconnect();
    process.exit(0);
  });
}
