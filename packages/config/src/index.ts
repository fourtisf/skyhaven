import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Walk up from this file to find the monorepo root .env so every service
// shares a single source of env truth in development.
function findRepoEnv(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate) && existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

loadDotenv({ path: findRepoEnv() });

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  WEB_PORT: z.coerce.number().int().positive().default(3000),
  API_PORT: z.coerce.number().int().positive().default(4000),
  REALTIME_PORT: z.coerce.number().int().positive().default(2567),

  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_REALTIME_URL: z.string().default("ws://localhost:2567"),

  DATABASE_URL: z
    .string()
    .default("postgresql://volari:volari@localhost:5432/volari?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Auth (Phase 5/6 wallet login). Override in production.
  AUTH_SECRET: z.string().default("dev-insecure-secret-change-me"),
  AUTH_TOKEN_TTL: z.string().default("7d"),

  // Solana (Phase 6). Devnet until Phase 7 is reviewed (§10).
  SOLANA_CLUSTER: z.enum(["devnet", "mainnet-beta"]).default("devnet"),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail loud and early — a misconfigured env should never boot a service.
  console.error("✖ Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env: Env = parsed.data;

export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
