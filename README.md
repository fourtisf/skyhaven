# Volari

Sky-farm GameFi — a re-theme of the Mootopia base. Working name **Volari**, placeholder ticker **`$VOLA`**.

> **Server-authoritative by design.** The client sends *intent*; the server decides *outcome*. Growth, hunger, balances, and ownership are all derived from server-stored timestamps. See [`docs/VOLARI_HANDOFF.md`](docs/VOLARI_HANDOFF.md) for the full spec and the prototype ([`docs/volari.html`](docs/volari.html)) for the visual/mechanics reference.

This repo is built in phases (one per session). **Current status: Phase 0 — scaffold.** No game logic yet — just a running skeleton with health checks.

## Stack

| Layer | Package | Tech |
|---|---|---|
| Web shell / auth | `apps/web` | Next.js 14 (App Router) |
| Game client | `packages/game-client` | Phaser 3 (mounted in web) |
| Realtime authority | `apps/realtime` | Colyseus |
| API | `apps/api` | Fastify |
| DB + cache clients | `packages/db` | Prisma (PostgreSQL) + ioredis |
| Env config | `packages/config` | zod-validated env |
| Infra | `docker-compose.yml` | PostgreSQL 16 + Redis 7 |

## Layout

```
apps/
  web/        Next.js 14 shell — mounts the Phaser client, /api/health
  api/        Fastify REST — /health, /health/ready
  realtime/   Colyseus server — /health, /health/ready, WS transport
packages/
  config/     @volari/config — zod-validated env, shared by all services
  db/         @volari/db — lazy Prisma + Redis clients, health helpers
  game-client/@volari/game-client — Phaser 3 boot scene
docs/         handoff spec + HTML prototype
```

## Getting started

```bash
# 1. Install
pnpm install

# 2. Env
cp .env.example .env

# 3. Infra (PostgreSQL + Redis)
pnpm infra:up

# 4. Generate the Prisma client (schema is filled in Phase 1)
pnpm db:generate

# 5. Run everything (web :3000, api :4000, realtime :2567)
pnpm dev
```

Run a single service with pnpm filters, e.g. `pnpm --filter @volari/api dev`.

## Health checks

| Service | Liveness | Readiness (deps) |
|---|---|---|
| web | `GET http://localhost:3000/api/health` | — |
| api | `GET http://localhost:4000/health` | `GET http://localhost:4000/health/ready` |
| realtime | `GET http://localhost:2567/health` | `GET http://localhost:2567/health/ready` |

Liveness returns `200` whenever the process is up. Readiness reports
PostgreSQL + Redis connectivity and returns `503` when a dependency is down —
so `pnpm dev` boots and serves liveness even before `pnpm infra:up`.

## Ports

| Service | Port | Env var |
|---|---|---|
| web | 3000 | `WEB_PORT` |
| api | 4000 | `API_PORT` |
| realtime | 2567 | `REALTIME_PORT` |
| PostgreSQL | 5432 | `DATABASE_URL` |
| Redis | 6379 | `REDIS_URL` |

## Roadmap

Phases are defined in [`docs/VOLARI_HANDOFF.md`](docs/VOLARI_HANDOFF.md) §9:

- **Phase 0 — Scaffold** ✅ (this commit)
- Phase 1 — Prisma schema & world seed
- Phase 2 — Authoritative IslandRoom + Phaser render
- Phase 3 — Farming + animals (server timers)
- Phase 4 — Economy, shop, market
- Phase 5 — Land claim + Volari Deeds (cNFT) + neighbors
- Phase 6 — `$VOLA` token integration
- Phase 7 — Quests, decoration, anti-cheat, polish

> ⚠️ Devnet only. No real `$VOLA` value or mainnet Volari Deeds until Phase 7 (anti-cheat + reconciliation) is reviewed.
