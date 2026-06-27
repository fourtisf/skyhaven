import cors from "@fastify/cors";
import { env } from "@volari/config";
import { checkDatabase, checkRedis, disconnect } from "@volari/db";
import Fastify from "fastify";
import { registerAuthRoutes } from "./auth.js";

const app = Fastify({
  logger: {
    transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
  },
});

await app.register(cors, { origin: true });

// Liveness — is the process up? Cheap, no dependencies touched.
app.get("/health", async () => ({
  status: "ok",
  service: "api",
  time: new Date().toISOString(),
}));

// Readiness — are downstream dependencies reachable?
app.get("/health/ready", async (_req, reply) => {
  const [db, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const ready = db === "up" && redis === "up";
  reply.code(ready ? 200 : 503);
  return { status: ready ? "ready" : "degraded", service: "api", deps: { db, redis } };
});

// Wallet auth (Phase 5/6): nonce → signature verify → JWT session.
registerAuthRoutes(app);

// ── Still to come per §4: GET /shop, GET /profile/:wallet, POST /vola/settle,
//    POST /deed/mint-callback (Helius webhook). ──

const start = async () => {
  try {
    await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
    app.log.info(`Volari API listening on :${env.API_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await disconnect();
    process.exit(0);
  });
}

void start();
