import cors from "@fastify/cors";
import { env } from "@volari/config";
import { checkDatabase, checkRedis, disconnect } from "@volari/db";
import Fastify from "fastify";

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

// ── Phase 0: no game routes yet. REST contract (auth, /shop, /profile,
//    /sky/settle, /deed/mint-callback) lands in later phases per §4. ──

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
