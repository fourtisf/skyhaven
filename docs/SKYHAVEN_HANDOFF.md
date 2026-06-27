# SKYHAVEN — Production Handoff for Claude Code

**For:** Michael
**From:** ALFA (product/design) via Claude (prototype + spec)
**Prototype:** `skyhaven.html` (single-file canvas, attach alongside this doc)
**Status:** Sky-farm GameFi — re-theme of the Mootopia base. Working name `Skyhaven`, placeholder ticker `$SKY`. Lock name/ticker before propagating to repo, domain, SPL mint, and package names.

---

## 0. How to send this to Claude Code (do this first)

1. Create the repo (e.g. `skyhaven`) under the `fourtisio` org and push an empty scaffold (`git init`, README).
2. Open a **fresh Claude Code session in the repo root**.
3. Attach **3 things** to that session:
   - this file (`SKYHAVEN_HANDOFF.md`)
   - the prototype (`skyhaven.html`)
   - the kickoff prompt for the current phase (from §9 below)
4. Run **one phase per session**. `git commit` between every phase, then start a new session for the next phase. This keeps Claude Code's context clean — do not try to do all phases in one session.
5. **Do not attach real `$SKY` value or mint real Sky Deeds on mainnet until Phase 7 (anti-cheat) is done and reviewed.** Use devnet throughout.

> The prototype is a **visual + mechanics reference only**. Its economy runs client-side, which is exactly what production must NOT do. In production the **server is authoritative** for every timer, balance, and ownership change. Treat the prototype as "what it should look and feel like", not "how it should be built".

---

## 1. Recommended stack (consistent with the Fourtis ecosystem)

| Layer | Choice | Notes |
|---|---|---|
| Game client | **Phaser 3** | Port the prototype's canvas rendering. Mounted inside a Next.js page. |
| Web shell / auth | **Next.js 14 (App Router)** | Wallet connect, landing, leaderboard, account. |
| Realtime / authority | **Colyseus** | One authoritative room per island; read-only join for neighbor visits. |
| API | **Fastify** (or Next route handlers) | REST for non-realtime (shop catalog, profile, settlement). |
| DB | **PostgreSQL + Prisma** | Source of truth for state. |
| Cache / locks | **Redis** | Rate limits, action locks, room presence. |
| Chain data | **Helius** | RPC + webhooks + DAS API for cNFT reads. |
| NFT (Sky Deeds) | **Metaplex Bubblegum (compressed NFTs)** | Cheap mint, same approach as Mootopia. |
| Token (`$SKY`) | **SPL token** | Scarce hard currency. Accrue off-chain, settle on-chain. |
| Payments | **SOL** | Premium plots/animals; same model as other Fourtis products. |
| Hosting | **PM2 on Hostinger VPS** | Same ops as PumpRadar/HWAIAGENT. |

---

## 2. Server-authoritative architecture

```
            ┌──────────────────────────────────────────────┐
            │  Phaser client (dumb renderer + input only)   │
            │  - renders state it receives                  │
            │  - sends intents: "till tile 12", "claim p7"  │
            │  - NEVER computes coins/growth/ownership      │
            └───────────────┬──────────────────────────────┘
                            │ Colyseus room messages (intents)
            ┌───────────────▼──────────────────────────────┐
            │  Colyseus IslandRoom  (AUTHORITY)             │
            │  - validates ownership, balance, cooldown     │
            │  - computes timers from server timestamps     │
            │  - mutates state → broadcasts patch           │
            └───────┬───────────────────────┬──────────────┘
                    │ Prisma                 │ jobs/queue
            ┌───────▼─────────┐      ┌───────▼──────────────┐
            │ PostgreSQL      │      │ Chain workers        │
            │ (source of truth)│     │ - mint Sky Deed cNFT │
            └─────────────────┘      │ - settle $SKY claims │
                    │                 │ (Helius + Bubblegum) │
            ┌───────▼─────────┐      └──────────────────────┘
            │ Redis (locks,   │
            │ rate limits)    │
            └─────────────────┘
```

**Golden rule:** the client sends *intent*, the server decides *outcome*. Growth, hunger, produce-ready, coin/$SKY deltas, and plot ownership are all derived from server-stored timestamps and validated server-side.

---

## 3. Data model (Prisma — minimum viable)

```prisma
model User {
  id            String   @id @default(cuid())
  wallet        String   @unique
  level         Int      @default(1)
  xp            Int      @default(0)
  coins         Int      @default(55)        // off-chain soft currency
  skyPending    BigInt   @default(0)         // earned $SKY not yet settled on-chain
  feed          Int      @default(5)
  seeds         Int      @default(6)
  animalCap     Int      @default(6)
  createdAt     DateTime @default(now())
  lastSeen      DateTime @updatedAt

  parcels       Parcel[]
  animals       Animal[]
  inventory     InventoryItem[]
  quest         QuestProgress?
  ledger        LedgerEntry[]
}

model Parcel {
  id            String   @id @default(cuid())
  gridX         Int
  gridY         Int
  status        ParcelStatus @default(CLAIMABLE) // LOCKED | CLAIMABLE | OWNED | NPC
  ownerId       String?
  owner         User?    @relation(fields: [ownerId], references: [id])
  npcName       String?
  claimCost     Int      @default(0)
  requiredLevel Int      @default(1)
  deedAssetId   String?  // Bubblegum cNFT asset id once claimed
  tiles         Tile[]
  @@unique([gridX, gridY])
}

enum ParcelStatus { LOCKED CLAIMABLE OWNED NPC }

model Tile {
  id          String   @id @default(cuid())
  parcelId    String
  parcel      Parcel   @relation(fields: [parcelId], references: [id])
  localX      Int
  localY      Int
  // farming
  state       TileState @default(GRASS)   // GRASS | TILLED | PLANTED
  cropType    String?
  plantedAt   DateTime?
  watered     Boolean   @default(false)
  growSeconds Int?      // resolved server-side; ready when plantedAt + growSeconds <= now
  // decoration (mutually exclusive with crop)
  decorType   String?
  @@unique([parcelId, localX, localY])
}

enum TileState { GRASS TILLED PLANTED }

model Animal {
  id            String   @id @default(cuid())
  ownerId       String
  owner         User     @relation(fields: [ownerId], references: [id])
  type          String   // SHEEP | HEN | AURORA
  premium       Boolean  @default(false)
  x             Float
  y             Float
  fed           Boolean  @default(true)
  hungerAt      DateTime // becomes hungry at this time
  produceReadyAt DateTime?
  hasProduce    Boolean  @default(false)
}

model InventoryItem {
  id      String @id @default(cuid())
  userId  String
  user    User   @relation(fields: [userId], references: [id])
  item    String // WOOL | EGG | BERRY | GOLDWOOL
  qty     Int    @default(0)
  @@unique([userId, item])
}

model QuestProgress {
  id          String @id @default(cuid())
  userId      String @unique
  user        User   @relation(fields: [userId], references: [id])
  step        Int    @default(0)      // onboarding chain index
  flags       Json   @default("{}")   // checked/harvested/planted/...
  dailyType   String @default("harvest")
  dailyNeed   Int    @default(5)
  dailyHave   Int    @default(0)
  dailyResetAt DateTime?
}

model LedgerEntry {            // audit trail — REQUIRED for anti-cheat
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  kind      String   // CLAIM | SELL | BUY | QUEST | HARVEST | SKY_SETTLE ...
  coinDelta Int      @default(0)
  skyDelta  BigInt   @default(0)
  meta      Json     @default("{}")
  createdAt DateTime @default(now())
}
```

Seed at migration time: generate the world grid + parcels (same blob/noise layout as the prototype, or a fixed handcrafted map), assign NPC parcels, set escalating `claimCost`/`requiredLevel`, and give each new user a starter parcel + starter inventory.

---

## 4. Message / API contract

**Colyseus IslandRoom — client → server intents** (all validated server-side):

| Message | Payload | Server checks |
|---|---|---|
| `move` | `{dx, dy}` | clamp to land + owned/walkable; never trust position |
| `claimPlot` | `{parcelId}` | status CLAIMABLE, level≥req, coins≥cost → debit, set OWNED, queue cNFT mint |
| `till` | `{tileId}` | tile in OWNED parcel, state GRASS |
| `plant` | `{tileId}` | state TILLED, seeds>0 → debit seed, set PLANTED + plantedAt |
| `water` | `{tileId}` | state PLANTED → set watered (affects growSeconds) |
| `harvestCrop` | `{tileId}` | PLANTED and `now>=plantedAt+growSeconds` → grant berries, reset to TILLED |
| `harvestAnimal` | `{animalId}` | owns animal, hasProduce → grant item (server rolls Golden Wool), reset timer |
| `feed` | `{animalId}` | feed>0 → debit, set fed, reset hungerAt |
| `placeDecor` | `{tileId, decorType}` | OWNED tile, no crop, coins≥cost → debit, set decorType |
| `removeDecor` | `{tileId}` | OWNED tile with decor → clear |
| `sell` | `{item, qty}` | qty≤inventory → credit coins ($SKY for GOLDWOOL via skyPending) |
| `buy` | `{shopItemId}` | catalog price, cap checks → debit, grant |
| `claimQuest` | `{}` | server recomputes completion from flags; never trust client |

**REST (Fastify / Next routes):**
- `POST /auth/nonce` + `POST /auth/verify` — wallet signature login.
- `GET /shop` — catalog (server-owned prices).
- `GET /profile/:wallet` — read-only profile/leaderboard.
- `POST /sky/settle` — settle `skyPending` → on-chain SPL transfer to wallet (Phase 6).
- `POST /deed/mint-callback` — Helius webhook confirming cNFT mint, writes `deedAssetId`.

Server response pattern: after any successful intent, broadcast a **state patch** (Colyseus `@type` schema diff), not full state.

---

## 5. Tokenomics (dual currency — same model as Mootopia)

- **Coins** — soft, off-chain, high-velocity. Earned from selling Cloudwool/Egg/Berry + quests. Spent on feed, seeds, animals, decor, plot claims, capacity. Inflationary by design; sinks must keep pace.
- **`$SKY`** — hard, on-chain SPL, scarce. Earned **only** from rare drops (Golden Wool) and milestone quest rewards. Accrued in `skyPending`, settled on-chain in batches (gas-efficient). Spent on premium animals (Aurora Sheep), premium plots, and future cosmetics.
- **Sky Deeds** — land = Bubblegum cNFT, minted on claim. Tradable later = the speculation/ownership hook. Parcel ↔ deed is 1:1.

**Faucet/sink balance to define before launch:** target a net coin sink so a daily-active player trends toward needing to claim plots / buy premium rather than hoarding. Model this in a sheet before assigning real value.

---

## 6. Anti-cheat / security (gate before any real value)

- Server computes **all** timers from stored timestamps; reject any client-reported progress.
- Per-action **Redis rate limits** + idempotency keys; one in-flight action per user via lock.
- Every balance change writes a `LedgerEntry`; reconcile `coins`/`skyPending` against ledger sum on a schedule — mismatch = flag + freeze.
- Movement validated server-side (land mask + speed cap); ignore teleports.
- Chain actions (claim/settle) signed by a **custodial mint/treasury authority**, never the client; verify wallet ownership via signed nonce.
- $SKY settlement is **debit-pending-then-transfer** with on-chain tx confirmation before clearing `skyPending`.

---

## 7. Prototype → production mapping (what's mock now)

| Prototype (mock, client-side) | Production (authoritative) |
|---|---|
| Coins/$SKY in JS `State` | `User.coins` / `skyPending` + on-chain SPL |
| Sky Deed "#N (mock NFT)" | Bubblegum cNFT, `Parcel.deedAssetId` |
| Crop growth via `requestAnimationFrame` | `plantedAt + growSeconds`, server-computed |
| Animal produce/hunger timers in client | server timestamps on `Animal` |
| `localStorage` save | PostgreSQL + Colyseus state |
| NPC parcels = static decoration | real read-only neighbor visits (join their room) |
| Golden Wool roll on client | server-side weighted roll, logged |
| Demo timers (9–16s) | rebalanced to minutes/hours (see §8) |

---

## 8. Demo timers — REBALANCE before launch

Prototype values are intentionally fast for a 60-second demo. Production targets (tune in playtests):

| Action | Prototype | Suggested production |
|---|---|---|
| Hen egg | 9s | 20–45 min |
| Sheep wool | 12s | 1–3 h |
| Crop grow (watered) | 15s | 2–6 h |
| Crop grow (unwatered) | ~43s | much slower / stalls |
| Animal hunger | 34s | 6–12 h |
| Berry bush | 16s | 30–60 min |

---

## 9. Phased Claude Code build prompts (one per session)

Paste the matching block into a fresh Claude Code session. Commit after each.

**Phase 0 — Scaffold**
> Scaffold a monorepo for "Skyhaven": a Next.js 14 (App Router) web app, a Phaser 3 client package, a Colyseus server, and a Fastify API, sharing a Prisma package (PostgreSQL) and Redis. Set up TypeScript, env config, and a dev script that runs all services. No game logic yet — just a running skeleton with a health check. Commit.

**Phase 1 — Schema & seed**
> Implement the Prisma schema from SKYHAVEN_HANDOFF.md §3. Add migrations and a seed script that generates the island world grid + parcels (mirror the prototype's layout), assigns 3 NPC parcels, sets escalating claimCost/requiredLevel on claimable parcels, and creates a test user with a starter parcel + starter inventory. Commit.

**Phase 2 — Authoritative room + render**
> Build the Colyseus `IslandRoom` with server-authoritative state (players, parcels, tiles, animals) loaded from Prisma. Implement `move` with server-side land/speed validation. Build a minimal Phaser 3 client that connects, renders the baked terrain + floating-island look + player from the prototype (skyhaven.html), and follows server state. No economy yet. Commit.

**Phase 3 — Farming + animals (server timers)**
> Implement `till`, `plant`, `water`, `harvestCrop`, and animal `harvestAnimal`/`feed` as authoritative messages. All growth/hunger/produce derived from server timestamps per §4 and §8. Update the Phaser client to render tile states, growing crops, and animal produce/hunger bubbles. Commit.

**Phase 4 — Economy, shop, market**
> Add coins (off-chain), inventory, the Barn shop, and the Sky Market sell flow as authoritative intents with `LedgerEntry` writes for every delta. Add XP/level. Server owns all prices (GET /shop). Wire the prototype's modal UIs to real data. Commit.

**Phase 5 — Land claim + Sky Deeds (cNFT) + neighbors**
> Implement `claimPlot` (debit coins, set OWNED, queue Bubblegum cNFT mint via Helius on devnet, write deedAssetId on webhook callback). Add read-only neighbor visits (join another user's room). Render owned/NPC/claimable parcel borders + beacons from the prototype. Commit.

**Phase 6 — $SKY token integration**
> Add wallet connect (Next.js) and SPL `$SKY` on devnet. Golden Wool + milestone quests accrue to `skyPending`; implement `POST /sky/settle` (debit-pending → on-chain transfer → confirm → clear). Enable premium purchases (Aurora Sheep, premium plots) priced in $SKY/SOL. Commit.

**Phase 7 — Quests, decoration, anti-cheat, polish**
> Implement the onboarding quest chain + daily quest (server-validated) and the decoration build mode (place/remove decor on owned tiles). Then harden: Redis rate limits, action locks, ledger reconciliation job, movement/teleport rejection per §6. Rebalance all timers to §8. Mobile + perf pass. Commit. Do not move $SKY/Deeds to mainnet until this phase is reviewed.

---

## 10. Risk callouts

- **Lock the name + ticker first.** Watch the "ranlands/ranchlands" traffic-bleed lesson — pick the final spelling before repo/domain/SPL mint propagate.
- **No real value before Phase 7.** Devnet only until anti-cheat + reconciliation are reviewed.
- **Economy is a spreadsheet problem, not a code problem.** Model faucets/sinks before assigning `$SKY` value.
- **cNFT mint cost/latency** — batch mints; don't block the claim UX on chain confirmation (optimistic OWNED, reconcile on webhook).
- **Prototype timers are demo-fast on purpose** — shipping them as-is would wreck the economy.
