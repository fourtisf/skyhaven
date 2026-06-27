import { Room, type Client } from "@colyseus/core";
import {
  isLandPx,
  isPond,
  SPAWN,
  TILE,
  WORLD_W,
  WORLD_H,
  generateParcels,
  DEMO_TIMERS,
  SELL_COINS,
  SELL_VOLA,
  SHOP_ITEMS,
  xpForNext,
  XP,
} from "@volari/world";
import { IslandState, Player, Crop, Animal, Parcel } from "./schema.js";
import { recordLedger } from "../ledger.js";
import { mintDeed } from "../chain/deeds.js";

const SPEED = 190; // px/sec — server-owned movement speed
const TICK_HZ = 30;
const REACH = TILE * 1.6; // how close a player must be to act on a tile/animal
const GOLDEN_WOOL_CHANCE = 0.08;

// Phase 3 uses the prototype's demo-fast timers so the loop is playable in
// seconds. Phase 7 rebalances to the production TIMERS (§8).
const T = DEMO_TIMERS;

interface JoinOptions {
  name?: string;
  wallet?: string;
}
interface MoveMessage {
  dx?: number;
  dy?: number;
}
interface TileMessage {
  x?: number;
  y?: number;
}
interface AnimalMessage {
  id?: string;
}
interface SellMessage {
  item?: string;
  qty?: number;
}
interface BuyMessage {
  shopItemId?: string;
}
interface ClaimMessage {
  parcelId?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function tileKey(tx: number, ty: number): string {
  return `${tx}:${ty}`;
}

/**
 * Authoritative island room (Phases 2–3).
 *
 * The client sends intents; the server owns position, tile state, crop growth,
 * and animal produce/hunger — all derived from server timestamps (§2). Phase 3
 * holds state in memory (seeded from @volari/world); Phase 4 persists mutations
 * through @volari/db and adds coins/market/XP.
 */
export class IslandRoom extends Room<IslandState> {
  override maxClients = 30;
  private animalSeq = 0;
  private tileParcel = new Map<string, number>(); // "x:y" → parcel index

  override onCreate(): void {
    this.setState(new IslandState());
    this.seedParcels();

    this.onMessage("move", (client, m: MoveMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      let dx = Number(m?.dx) || 0;
      let dy = Number(m?.dy) || 0;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      p.inx = dx;
      p.iny = dy;
    });

    this.onMessage("till", (c, m: TileMessage) => this.onTill(c, m));
    this.onMessage("plant", (c, m: TileMessage) => this.onPlant(c, m));
    this.onMessage("water", (c, m: TileMessage) => this.onWater(c, m));
    this.onMessage("harvestCrop", (c, m: TileMessage) => this.onHarvestCrop(c, m));
    this.onMessage("harvestAnimal", (c, m: AnimalMessage) => this.onHarvestAnimal(c, m));
    this.onMessage("feed", (c, m: AnimalMessage) => this.onFeed(c, m));
    this.onMessage("sell", (c, m: SellMessage) => this.onSell(c, m));
    this.onMessage("buy", (c, m: BuyMessage) => this.onBuy(c, m));
    this.onMessage("claimPlot", (c, m: ClaimMessage) => this.onClaimPlot(c, m));

    this.setSimulationInterval((dt) => this.tick(dt), 1000 / TICK_HZ);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const p = new Player();
    p.x = SPAWN.x;
    p.y = SPAWN.y;
    p.name = (options.name ?? "Pilot").slice(0, 16);
    p.wallet = (options.wallet ?? "").slice(0, 64);
    this.state.players.set(client.sessionId, p);
    this.grantStarterAnimals(client.sessionId);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    // Remove this player's animals.
    for (const [id, a] of this.state.animals) {
      if (a.owner === client.sessionId) this.state.animals.delete(id);
    }
    // Release their land back to claimable (no persistence yet).
    this.releaseParcels(client.sessionId);
  }

  // ── farming intents ────────────────────────────────────────
  private near(p: Player, tx: number, ty: number): boolean {
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    return Math.hypot(p.x - cx, p.y - cy) <= REACH;
  }

  private onTill(client: Client, m: TileMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const tx = Math.floor(Number(m?.x));
    const ty = Math.floor(Number(m?.y));
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    if (!this.near(p, tx, ty)) return;
    if (!isLandPx(tx * TILE + 28, ty * TILE + 28) || isPond(tx, ty)) return;
    if (!this.ownsTile(client.sessionId, tx, ty)) return; // farm only your land
    const key = tileKey(tx, ty);
    if (this.state.crops.has(key)) return; // already tilled/planted
    const crop = new Crop();
    crop.state = "TILLED";
    crop.worldX = tx;
    crop.worldY = ty;
    this.state.crops.set(key, crop);
  }

  private onPlant(client: Client, m: TileMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const tx = Math.floor(Number(m?.x));
    const ty = Math.floor(Number(m?.y));
    const crop = this.state.crops.get(tileKey(tx, ty));
    if (!crop || crop.state !== "TILLED") return;
    if (!this.near(p, tx, ty)) return;
    if (p.seeds <= 0) return;
    p.seeds -= 1;
    const now = Date.now();
    crop.state = "PLANTED";
    crop.cropType = "BERRY";
    crop.plantedAt = now;
    crop.watered = false;
    crop.readyAt = now + T.cropUnwateredMs; // unwatered is slow until watered
  }

  private onWater(client: Client, m: TileMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const tx = Math.floor(Number(m?.x));
    const ty = Math.floor(Number(m?.y));
    const crop = this.state.crops.get(tileKey(tx, ty));
    if (!crop || crop.state !== "PLANTED" || crop.watered) return;
    if (!this.near(p, tx, ty)) return;
    const now = Date.now();
    crop.watered = true;
    // Watering accelerates the remaining grow time (prototype: ~0.35× → 1×).
    crop.readyAt = now + Math.max(0, (crop.readyAt - now) * 0.35);
  }

  private onHarvestCrop(client: Client, m: TileMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const tx = Math.floor(Number(m?.x));
    const ty = Math.floor(Number(m?.y));
    const crop = this.state.crops.get(tileKey(tx, ty));
    if (!crop || crop.state !== "PLANTED") return;
    if (!this.near(p, tx, ty)) return;
    if (Date.now() < crop.readyAt) return; // not ready — server decides
    p.berries += 1;
    this.grantXp(p, XP.harvestCrop);
    recordLedger(client.sessionId, "HARVEST", 0, 0, { item: "BERRY", qty: 1 });
    // Reset to tilled soil so it can be replanted.
    crop.state = "TILLED";
    crop.cropType = "";
    crop.plantedAt = 0;
    crop.readyAt = 0;
    crop.watered = false;
  }

  // ── animal intents ─────────────────────────────────────────
  private onHarvestAnimal(client: Client, m: AnimalMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const a = this.state.animals.get(String(m?.id));
    if (!a || a.owner !== client.sessionId || !a.hasProduce) return;
    if (Math.hypot(p.x - a.x, p.y - a.y) > REACH) return;
    if (a.type === "HEN") {
      p.eggs += 1;
    } else if (a.type === "AURORA") {
      p.goldwool += 1;
    } else {
      // SHEEP: server rolls Golden Wool (logged in a later phase).
      if (this.roll() < GOLDEN_WOOL_CHANCE) p.goldwool += 1;
      else p.wool += 1;
    }
    a.hasProduce = false;
    a.produceReadyAt = Date.now() + this.produceMs(a.type);
    this.grantXp(p, XP.harvestAnimal);
    recordLedger(client.sessionId, "HARVEST", 0, 0, { animal: a.type });
  }

  private onFeed(client: Client, m: AnimalMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const a = this.state.animals.get(String(m?.id));
    if (!a || a.owner !== client.sessionId) return;
    if (Math.hypot(p.x - a.x, p.y - a.y) > REACH) return;
    if (p.feed <= 0) return;
    p.feed -= 1;
    a.fed = true;
    a.hungerAt = Date.now() + T.hungerMs;
  }

  // ── economy intents ────────────────────────────────────────
  private onSell(client: Client, m: SellMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const item = String(m?.item ?? "");
    const qty = Math.floor(Number(m?.qty));
    if (!Number.isFinite(qty) || qty <= 0) return;

    const have = this.itemCount(p, item);
    if (have < qty) return;

    const coinEach = SELL_COINS[item] ?? 0;
    const volaEach = SELL_VOLA[item] ?? 0;
    if (coinEach === 0 && volaEach === 0) return; // not sellable

    this.setItemCount(p, item, have - qty);
    const coinDelta = coinEach * qty;
    const volaDelta = volaEach * qty;
    p.coins += coinDelta;
    p.volaPending += volaDelta;
    this.grantXp(p, XP.sell * qty);
    recordLedger(client.sessionId, "SELL", coinDelta, volaDelta, { item, qty });
  }

  private onBuy(client: Client, m: BuyMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const item = SHOP_ITEMS.find((s) => s.id === String(m?.shopItemId));
    if (!item) return;
    if (p.coins < item.price) return;

    if (item.kind === "animal") {
      if (this.countAnimals(client.sessionId) >= p.animalCap) return; // cap check
      p.coins -= item.price;
      this.spawnAnimal(client.sessionId, item.animalType ?? "HEN", p.x, p.y);
      this.grantXp(p, XP.buyAnimal);
    } else {
      p.coins -= item.price;
      if (item.kind === "seeds") p.seeds += item.amount;
      else p.feed += item.amount;
    }
    recordLedger(client.sessionId, "BUY", -item.price, 0, { shopItemId: item.id });
  }

  private grantXp(p: Player, amount: number): void {
    p.xp += amount;
    while (p.xp >= xpForNext(p.level)) {
      p.xp -= xpForNext(p.level);
      p.level += 1;
      p.animalCap += 1; // each level raises the animal cap a little
    }
  }

  private itemCount(p: Player, item: string): number {
    switch (item) {
      case "BERRY":
        return p.berries;
      case "EGG":
        return p.eggs;
      case "WOOL":
        return p.wool;
      case "GOLDWOOL":
        return p.goldwool;
      default:
        return 0;
    }
  }

  private setItemCount(p: Player, item: string, value: number): void {
    switch (item) {
      case "BERRY":
        p.berries = value;
        break;
      case "EGG":
        p.eggs = value;
        break;
      case "WOOL":
        p.wool = value;
        break;
      case "GOLDWOOL":
        p.goldwool = value;
        break;
    }
  }

  private countAnimals(sessionId: string): number {
    let n = 0;
    this.state.animals.forEach((a) => {
      if (a.owner === sessionId) n++;
    });
    return n;
  }

  // ── land claim (Phase 5) ───────────────────────────────────
  private seedParcels(): void {
    for (const wp of generateParcels()) {
      const parcel = new Parcel();
      parcel.index = wp.index;
      parcel.claimCost = wp.claimCost;
      parcel.requiredLevel = wp.requiredLevel;
      if (wp.owner === "npc") {
        parcel.status = "NPC";
        parcel.npcName = wp.npcName ?? "Neighbor";
        parcel.deedAssetId = `npc-deed-${wp.index}`;
      } else {
        // Both the starter parcel and the rest are claimable in the shared world.
        parcel.status = "CLAIMABLE";
      }
      // Bounding box + centroid (px) for client borders/beacons.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const t of wp.tiles) {
        minX = Math.min(minX, t.worldX * TILE);
        minY = Math.min(minY, t.worldY * TILE);
        maxX = Math.max(maxX, t.worldX * TILE + TILE);
        maxY = Math.max(maxY, t.worldY * TILE + TILE);
        this.tileParcel.set(tileKey(t.worldX, t.worldY), wp.index);
      }
      parcel.minX = minX;
      parcel.minY = minY;
      parcel.maxX = maxX;
      parcel.maxY = maxY;
      parcel.cx = (minX + maxX) / 2;
      parcel.cy = (minY + maxY) / 2;
      this.state.parcels.set(String(wp.index), parcel);
    }
  }

  private ownsTile(sessionId: string, tx: number, ty: number): boolean {
    const idx = this.tileParcel.get(tileKey(tx, ty));
    if (idx === undefined) return false;
    const parcel = this.state.parcels.get(String(idx));
    return Boolean(parcel && parcel.status === "OWNED" && parcel.ownerSession === sessionId);
  }

  private onClaimPlot(client: Client, m: ClaimMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const parcel = this.state.parcels.get(String(Math.floor(Number(m?.parcelId))));
    if (!parcel || parcel.status !== "CLAIMABLE") return;
    // Must be standing inside the parcel (anti-cheat).
    if (p.x < parcel.minX || p.x > parcel.maxX || p.y < parcel.minY || p.y > parcel.maxY) return;
    if (p.level < parcel.requiredLevel) return;
    if (p.coins < parcel.claimCost) return;

    p.coins -= parcel.claimCost;
    parcel.status = "OWNED";
    parcel.ownerSession = client.sessionId;
    parcel.ownerName = p.name;
    this.grantXp(p, 15);
    recordLedger(client.sessionId, "CLAIM", -parcel.claimCost, 0, { parcel: parcel.index });

    // Mint the Volari Deed cNFT without blocking the claim (§10).
    const wallet = p.wallet || client.sessionId;
    void mintDeed({
      wallet,
      parcelIndex: parcel.index,
      gridX: Math.floor(parcel.cx / TILE),
      gridY: Math.floor(parcel.cy / TILE),
    })
      .then((res) => {
        // Only stamp the deed if the same player still owns it.
        if (parcel.status === "OWNED" && parcel.ownerSession === client.sessionId) {
          parcel.deedAssetId = res.assetId;
        }
      })
      .catch(() => {
        /* mint failure is non-fatal; ownership stands, deed reconciles later */
      });
  }

  private releaseParcels(sessionId: string): void {
    const owned = new Set<number>();
    this.state.parcels.forEach((parcel) => {
      if (parcel.ownerSession === sessionId) owned.add(parcel.index);
    });
    if (owned.size === 0) return;
    // Clear crops on the freed tiles first…
    for (const [key, crop] of this.state.crops) {
      const idx = this.tileParcel.get(tileKey(crop.worldX, crop.worldY));
      if (idx !== undefined && owned.has(idx)) this.state.crops.delete(key);
    }
    // …then revert the parcels to claimable.
    this.state.parcels.forEach((parcel) => {
      if (parcel.ownerSession !== sessionId) return;
      parcel.status = "CLAIMABLE";
      parcel.ownerSession = "";
      parcel.ownerName = "";
      parcel.deedAssetId = "";
    });
  }

  // ── simulation ─────────────────────────────────────────────
  private tick(dtMs: number): void {
    const dt = dtMs / 1000;
    const now = Date.now();

    this.state.players.forEach((p) => {
      if (p.inx === 0 && p.iny === 0) return;
      const nx = p.x + p.inx * SPEED * dt;
      const ny = p.y + p.iny * SPEED * dt;
      if (isLandPx(nx, p.y)) p.x = clamp(nx, 0, WORLD_W);
      if (isLandPx(p.x, ny)) p.y = clamp(ny, 0, WORLD_H);
    });

    this.state.animals.forEach((a) => {
      if (now >= a.hungerAt) a.fed = false;
      if (a.fed && !a.hasProduce && now >= a.produceReadyAt) a.hasProduce = true;
    });
  }

  // ── helpers ────────────────────────────────────────────────
  private produceMs(type: string): number {
    return type === "SHEEP" || type === "AURORA" ? T.sheepWoolMs : T.henEggMs;
  }

  private roll(): number {
    // Server-side weighted roll. (Math.random is fine in the app runtime.)
    return Math.random();
  }

  private grantStarterAnimals(sessionId: string): void {
    const owned = generateParcels().find((p) => p.owner === "you");
    // Place on the owned tiles nearest spawn so a new player starts beside them.
    const spots = (owned?.tiles ?? [])
      .map((t) => ({ x: t.worldX * TILE + 28, y: t.worldY * TILE + 28 }))
      .sort((a, b) => Math.hypot(a.x - SPAWN.x, a.y - SPAWN.y) - Math.hypot(b.x - SPAWN.x, b.y - SPAWN.y))
      .slice(0, 2);
    this.spawnAnimal(sessionId, "HEN", spots[0]?.x ?? SPAWN.x, spots[0]?.y ?? SPAWN.y);
    this.spawnAnimal(sessionId, "SHEEP", spots[1]?.x ?? SPAWN.x, spots[1]?.y ?? SPAWN.y);
  }

  private spawnAnimal(sessionId: string, type: string, x: number, y: number): void {
    const now = Date.now();
    const a = new Animal();
    a.owner = sessionId;
    a.type = type;
    a.x = x;
    a.y = y;
    a.fed = true;
    a.hungerAt = now + T.hungerMs;
    a.produceReadyAt = now + this.produceMs(type);
    this.state.animals.set(`a${this.animalSeq++}`, a);
  }
}
