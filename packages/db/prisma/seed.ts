// Volari world seed (handoff §3 / Phase 1).
//
// Generates the deterministic island grid + parcels, assigns the starter
// parcel + 3 NPC parcels, sets escalating claimCost/requiredLevel on claimable
// parcels, and creates a test user with starter inventory + a couple of
// starter animals.
//
// Run on a machine with DB access:  pnpm --filter @volari/db exec prisma db seed
// (requires `prisma generate` + a reachable DATABASE_URL).

import { PrismaClient, ParcelStatus, TileState } from "@prisma/client";
import { generateParcels, SPAWN, TILE, TIMERS } from "@volari/world";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Idempotent reseed (dev only) — clear in FK-dependency order.
  await prisma.ledgerEntry.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.questProgress.deleteMany();
  await prisma.animal.deleteMany();
  await prisma.tile.deleteMany();
  await prisma.parcel.deleteMany();
  await prisma.user.deleteMany();

  const wallet =
    process.env.SEED_TEST_WALLET ?? "DEVNET_TEST_WALLET_11111111111111111111";

  const user = await prisma.user.create({
    data: {
      wallet,
      coins: 55,
      feed: 5,
      seeds: 6,
      animalCap: 6,
      level: 1,
      xp: 0,
      inventory: {
        create: [
          { item: "WOOL", qty: 0 },
          { item: "EGG", qty: 0 },
          { item: "BERRY", qty: 0 },
          { item: "GOLDWOOL", qty: 0 },
        ],
      },
      quest: {
        create: { step: 0, dailyType: "harvest", dailyNeed: 5, dailyHave: 0 },
      },
    },
  });

  const parcels = generateParcels();
  let deedCounter = 1;

  for (const p of parcels) {
    let status: ParcelStatus = ParcelStatus.CLAIMABLE;
    let ownerId: string | null = null;
    let npcName: string | null = null;
    let deedAssetId: string | null = null;

    if (p.owner === "you") {
      status = ParcelStatus.OWNED;
      ownerId = user.id;
      deedAssetId = `mock-deed-${deedCounter++}`;
    } else if (p.owner === "npc") {
      status = ParcelStatus.NPC;
      npcName = p.npcName;
      deedAssetId = `mock-deed-${deedCounter++}`;
    }

    await prisma.parcel.create({
      data: {
        gridX: p.gridX,
        gridY: p.gridY,
        status,
        ownerId,
        npcName,
        deedAssetId,
        claimCost: p.claimCost,
        requiredLevel: p.requiredLevel,
        tiles: {
          create: p.tiles.map((t) => ({
            localX: t.localX,
            localY: t.localY,
            worldX: t.worldX,
            worldY: t.worldY,
            state: TileState.GRASS,
          })),
        },
      },
    });
  }

  // Starter animals on the owned parcel.
  const owned = parcels.find((p) => p.owner === "you");
  const spots = (owned?.tiles ?? []).slice(0, 2).map((t) => ({
    x: t.worldX * TILE + 28,
    y: t.worldY * TILE + 28,
  }));
  const now = Date.now();

  await prisma.animal.createMany({
    data: [
      {
        ownerId: user.id,
        type: "HEN",
        x: spots[0]?.x ?? SPAWN.x,
        y: spots[0]?.y ?? SPAWN.y,
        fed: true,
        hungerAt: new Date(now + TIMERS.hungerMs),
        produceReadyAt: new Date(now + TIMERS.henEggMs),
        hasProduce: false,
      },
      {
        ownerId: user.id,
        type: "SHEEP",
        x: spots[1]?.x ?? SPAWN.x,
        y: spots[1]?.y ?? SPAWN.y,
        fed: true,
        hungerAt: new Date(now + TIMERS.hungerMs),
        produceReadyAt: new Date(now + TIMERS.sheepWoolMs),
        hasProduce: false,
      },
    ],
  });

  const ownedCount = parcels.filter((p) => p.owner === "you").length;
  const npcCount = parcels.filter((p) => p.owner === "npc").length;
  const claimable = parcels.filter((p) => p.owner === "none").length;
  console.log(
    `Seeded: user ${user.wallet} · ${parcels.length} parcels ` +
      `(${ownedCount} owned, ${npcCount} NPC, ${claimable} claimable) · 2 starter animals.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
