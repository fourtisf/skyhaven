import { env } from "@volari/config";
import { Redis } from "ioredis";

// Deterministic world model + balance constants (shared with the seed and the
// Phase 2 authoritative room).
export * from "./world.js";
export * from "./balance.js";

// ── Prisma ───────────────────────────────────────────────────
// Loaded lazily via dynamic import so this package stays importable even
// before `prisma generate` has run (e.g. a fresh checkout running a health
// check). Phase 0 has no domain models, so we type the client by the minimal
// surface we use. Phase 1 fills in the schema and switches to the fully typed
// generated `PrismaClient` import.
interface MinimalPrisma {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $disconnect(): Promise<void>;
}

let prisma: MinimalPrisma | undefined;

export async function getPrisma(): Promise<MinimalPrisma> {
  if (!prisma) {
    const mod = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => MinimalPrisma;
    };
    prisma = new mod.PrismaClient();
  }
  return prisma;
}

// ── Redis ────────────────────────────────────────────────────
let redis: Redis | undefined;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    redis.on("error", () => {
      // Swallow connection errors here; callers surface status via health checks.
    });
  }
  return redis;
}

// ── Health helpers ───────────────────────────────────────────
export type DepStatus = "up" | "down" | "unconfigured";

export async function checkDatabase(): Promise<DepStatus> {
  try {
    const client = await getPrisma();
    await client.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}

export async function checkRedis(): Promise<DepStatus> {
  try {
    const client = getRedis();
    if (client.status !== "ready") await client.connect().catch(() => {});
    const pong = await client.ping();
    return pong === "PONG" ? "up" : "down";
  } catch {
    return "down";
  }
}

export async function disconnect(): Promise<void> {
  await prisma?.$disconnect().catch(() => {});
  redis?.disconnect();
}
