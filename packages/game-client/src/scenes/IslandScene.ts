import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  COLS,
  ROWS,
  TILE,
  WORLD_W,
  WORLD_H,
  SPAWN,
  isLand,
  isLandPx,
  isPond,
  SHOP_ITEMS,
  SELL_COINS,
  SELL_VOLA,
  xpForNext,
} from "@volari/world";
import { connectIsland } from "../net/room";

const SPEED = 190; // px/sec — matches the server (offline fallback only)
const REACH = TILE * 1.6;

interface NetPlayer {
  x: number;
  y: number;
  name: string;
  seeds: number;
  feed: number;
  berries: number;
  eggs: number;
  wool: number;
  goldwool: number;
  coins: number;
  xp: number;
  level: number;
  volaPending: number;
  animalCap: number;
}
interface NetCrop {
  state: string;
  cropType: string;
  plantedAt: number;
  readyAt: number;
  watered: boolean;
  worldX: number;
  worldY: number;
}
interface NetAnimal {
  owner: string;
  type: string;
  x: number;
  y: number;
  fed: boolean;
  hasProduce: boolean;
}
interface NetParcel {
  index: number;
  status: string;
  ownerSession: string;
  ownerName: string;
  npcName: string;
  claimCost: number;
  requiredLevel: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
}
type SchemaMap<T> = {
  forEach: (cb: (v: T, key: string) => void) => void;
  get: (key: string) => T | undefined;
};

interface PendingAction {
  msg: string;
  payload: Record<string, unknown>;
  label: string;
}

export class IslandScene extends Phaser.Scene {
  private room?: Room;
  private online = false;

  private local!: Phaser.GameObjects.Container;
  private localPos = { x: SPAWN.x, y: SPAWN.y };
  private remotes = new Map<string, Phaser.GameObjects.Container>();
  private cropViews = new Map<string, Phaser.GameObjects.Container>();
  private animalViews = new Map<string, Phaser.GameObjects.Container>();
  private parcelGfx!: Phaser.GameObjects.Graphics;
  private parcelLabels = new Map<number, Phaser.GameObjects.Text>();

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<"up" | "down" | "left" | "right" | "act", Phaser.Input.Keyboard.Key>;
  private lastSent = { dx: 0, dy: 0 };

  private hud!: Phaser.GameObjects.Text;
  private inv!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private action: PendingAction | null = null;

  private shopPanel?: Phaser.GameObjects.Container;
  private marketPanel?: Phaser.GameObjects.Container;
  private get panelOpen(): boolean {
    return Boolean(this.shopPanel?.visible || this.marketPanel?.visible);
  }

  constructor() {
    super("island");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#bfe6ff");
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

    this.buildTerrain();
    this.parcelGfx = this.add.graphics().setDepth(2);

    this.local = this.makeAvatar("You", true);
    this.local.setPosition(this.localPos.x, this.localPos.y);
    this.cameras.main.startFollow(this.local, true, 0.12, 0.12);

    const kb = this.input.keyboard!;
    this.keys = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      act: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };
    this.cursors = kb.createCursorKeys();

    this.hud = this.add
      .text(10, 10, "", {
        fontFamily: "Nunito, sans-serif",
        fontSize: "15px",
        color: "#2a2540",
        backgroundColor: "rgba(255,253,246,0.9)",
        padding: { x: 10, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(5000);
    this.inv = this.add
      .text(10, 42, "", {
        fontFamily: "Nunito, sans-serif",
        fontSize: "14px",
        color: "#2a2540",
        backgroundColor: "rgba(255,253,246,0.9)",
        padding: { x: 10, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(5000);
    this.status = this.add
      .text(10, 74, "connecting…", {
        fontFamily: "Nunito, sans-serif",
        fontSize: "12px",
        color: "#2a2540",
        backgroundColor: "rgba(255,253,246,0.8)",
        padding: { x: 8, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(5000);
    this.prompt = this.add
      .text(0, 0, "", {
        fontFamily: "Fredoka, sans-serif",
        fontSize: "14px",
        color: "#ffffff",
        backgroundColor: "rgba(42,37,64,0.92)",
        padding: { x: 12, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(5001)
      .setOrigin(0.5)
      .setVisible(false);

    // E key or tap/click triggers the current contextual action.
    kb.on("keydown-E", () => this.fireAction());
    this.input.on("pointerdown", () => this.fireAction());

    // Shop (Barn) / Market panels.
    kb.on("keydown-B", () => this.togglePanel("shop"));
    kb.on("keydown-M", () => this.togglePanel("market"));
    kb.on("keydown-ESC", () => this.closePanels());

    void this.connect();
  }

  private async connect(): Promise<void> {
    const url = (this.registry.get("serverUrl") as string | undefined) ?? "";
    if (!url) {
      this.status.setText("offline (no server url) · explore with WASD");
      return;
    }
    try {
      const name = (this.registry.get("playerName") as string | undefined) ?? "Pilot";
      const room = await connectIsland(url, { name });
      this.room = room;
      this.online = true;
      this.status.setText("online · WASD move · E / tap to act");
      room.onLeave(() => {
        this.online = false;
        this.status.setText("disconnected · offline (explore only)");
      });
    } catch {
      this.status.setText("offline (server unreachable) · explore with WASD");
    }
  }

  override update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    const dx =
      (this.keys.left.isDown || this.cursors.left?.isDown ? -1 : 0) +
      (this.keys.right.isDown || this.cursors.right?.isDown ? 1 : 0);
    const dy =
      (this.keys.up.isDown || this.cursors.up?.isDown ? -1 : 0) +
      (this.keys.down.isDown || this.cursors.down?.isDown ? 1 : 0);
    let nx = dx;
    let ny = dy;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      nx /= len;
      ny /= len;
    }

    if (this.online && this.room) {
      if (nx !== this.lastSent.dx || ny !== this.lastSent.dy) {
        this.room.send("move", { dx: nx, dy: ny });
        this.lastSent = { dx: nx, dy: ny };
      }
      this.syncFromServer();
      this.syncParcels();
      this.syncCrops();
      this.syncAnimals();
      this.updateHud();
      this.computeAction();
    } else {
      this.stepLocal(nx, ny, dt);
      this.hud.setText("explore mode — connect a realtime server to farm");
    }
  }

  // ── movement ───────────────────────────────────────────────
  private stepLocal(nx: number, ny: number, dt: number): void {
    const tx = this.localPos.x + nx * SPEED * dt;
    const ty = this.localPos.y + ny * SPEED * dt;
    if (isLandPx(tx, this.localPos.y)) this.localPos.x = Phaser.Math.Clamp(tx, 0, WORLD_W);
    if (isLandPx(this.localPos.x, ty)) this.localPos.y = Phaser.Math.Clamp(ty, 0, WORLD_H);
    this.local.setPosition(this.localPos.x, this.localPos.y);
  }

  private syncFromServer(): void {
    const room = this.room;
    if (!room) return;
    const players = room.state.players as SchemaMap<NetPlayer> | undefined;
    if (!players) return;
    const seen = new Set<string>();
    players.forEach((p, key) => {
      seen.add(key);
      if (key === room.sessionId) {
        this.localPos.x = p.x;
        this.localPos.y = p.y;
        this.local.setPosition(p.x, p.y);
        return;
      }
      let c = this.remotes.get(key);
      if (!c) {
        c = this.makeAvatar(p.name || "Pilot", false);
        this.remotes.set(key, c);
      }
      c.setPosition(p.x, p.y);
    });
    for (const [key, c] of this.remotes) {
      if (!seen.has(key)) {
        c.destroy();
        this.remotes.delete(key);
      }
    }
  }

  // ── crops ──────────────────────────────────────────────────
  private syncCrops(): void {
    const room = this.room;
    if (!room) return;
    const crops = room.state.crops as SchemaMap<NetCrop> | undefined;
    if (!crops) return;
    const now = Date.now();
    const seen = new Set<string>();
    crops.forEach((c, key) => {
      seen.add(key);
      let view = this.cropViews.get(key);
      if (!view) {
        view = this.add.container(0, 0).setDepth(3);
        view.setData("kind", "");
        this.cropViews.set(key, view);
      }
      const cx = c.worldX * TILE + TILE / 2;
      const cy = c.worldY * TILE + TILE / 2;
      view.setPosition(cx, cy);
      this.paintCrop(view, c, now);
    });
    for (const [key, v] of this.cropViews) {
      if (!seen.has(key)) {
        v.destroy();
        this.cropViews.delete(key);
      }
    }
  }

  private paintCrop(view: Phaser.GameObjects.Container, c: NetCrop, now: number): void {
    view.removeAll(true);
    // Soil patch.
    const soil = this.add
      .rectangle(0, 0, TILE - 14, TILE - 14, c.watered ? 0x6a4a32 : 0x8a5a3c)
      .setStrokeStyle(2, 0x5a3c28);
    view.add(soil);

    if (c.state === "PLANTED") {
      const ready = now >= c.readyAt;
      if (ready) {
        // Ripe berries.
        for (const [ox, oy] of [
          [-6, -2],
          [6, -2],
          [0, -10],
        ] as const) {
          view.add(this.add.circle(ox, oy, 5, 0x8e3bd6).setStrokeStyle(1, 0x5a2487));
        }
        view.setScale(1 + Math.sin(now / 180) * 0.06);
      } else {
        const frac = Phaser.Math.Clamp(
          (now - c.plantedAt) / Math.max(1, c.readyAt - c.plantedAt),
          0.05,
          1,
        );
        const h = 6 + frac * 18;
        view.add(this.add.rectangle(0, 6 - h / 2, 4, h, 0x4caf50));
        view.add(this.add.circle(0, 6 - h, 4 + frac * 4, 0x68c46a));
        view.setScale(1);
        if (c.watered) view.add(this.add.circle(10, 8, 3, 0x4ea3e0, 0.9));
      }
    } else {
      view.setScale(1);
    }
  }

  // ── animals ────────────────────────────────────────────────
  private syncAnimals(): void {
    const room = this.room;
    if (!room) return;
    const animals = room.state.animals as SchemaMap<NetAnimal> | undefined;
    if (!animals) return;
    const seen = new Set<string>();
    animals.forEach((a, key) => {
      seen.add(key);
      let view = this.animalViews.get(key);
      if (!view) {
        view = this.makeAnimal(a.type);
        this.animalViews.set(key, view);
      }
      view.setPosition(a.x, a.y);
      const bubble = view.getByName("bubble") as Phaser.GameObjects.Text | null;
      if (bubble) bubble.setVisible(a.hasProduce);
      const hungry = view.getByName("hungry") as Phaser.GameObjects.Text | null;
      if (hungry) hungry.setVisible(!a.fed);
    });
    for (const [key, v] of this.animalViews) {
      if (!seen.has(key)) {
        v.destroy();
        this.animalViews.delete(key);
      }
    }
  }

  private makeAnimal(type: string): Phaser.GameObjects.Container {
    const color = type === "HEN" ? 0xfff4e0 : type === "AURORA" ? 0xf6b8e0 : 0xf0ead8;
    const shadow = this.add.ellipse(0, 12, 30, 10, 0x000000, 0.18);
    const body = this.add.ellipse(0, 0, 30, 24, color).setStrokeStyle(2, 0x2a2540);
    const head = this.add.circle(11, -8, 7, color).setStrokeStyle(2, 0x2a2540);
    const produce = type === "HEN" ? "🥚" : type === "AURORA" ? "✨" : "🧶";
    const bubble = this.add
      .text(0, -26, produce, { fontSize: "16px" })
      .setOrigin(0.5)
      .setName("bubble")
      .setVisible(false);
    const hungry = this.add
      .text(-14, -20, "❗", { fontSize: "14px" })
      .setOrigin(0.5)
      .setName("hungry")
      .setVisible(false);
    return this.add.container(0, 0, [shadow, body, head, bubble, hungry]).setDepth(900);
  }

  // ── contextual action ──────────────────────────────────────
  private computeAction(): void {
    const room = this.room;
    if (!room) {
      this.action = null;
      this.prompt.setVisible(false);
      return;
    }
    const me = (room.state.players as SchemaMap<NetPlayer>).get(room.sessionId);
    if (!me) return;
    const px = this.localPos.x;
    const py = this.localPos.y;

    // 1) Animals in reach.
    let best: PendingAction | null = null;
    (room.state.animals as SchemaMap<NetAnimal>).forEach((a, id) => {
      if (a.owner !== room.sessionId) return;
      if (Math.hypot(px - a.x, py - a.y) > REACH) return;
      if (a.hasProduce) best = { msg: "harvestAnimal", payload: { id }, label: "Collect" };
      else if (!a.fed && me.feed > 0 && !best)
        best = { msg: "feed", payload: { id }, label: "Feed" };
    });

    // 2) Land claim, or farming on land you own.
    const parcel = this.parcelAt(px, py);
    if (!best && parcel && parcel.status === "CLAIMABLE") {
      if (me.level >= parcel.requiredLevel) {
        const cost = parcel.claimCost > 0 ? ` (${parcel.claimCost}🪙)` : "";
        best = { msg: "claimPlot", payload: { parcelId: parcel.index }, label: `Claim plot${cost}` };
      }
    } else if (!best && parcel && parcel.status === "OWNED" && parcel.ownerSession === room.sessionId) {
      const tx = Math.floor(px / TILE);
      const ty = Math.floor(py / TILE);
      const key = `${tx}:${ty}`;
      const crop = (room.state.crops as SchemaMap<NetCrop>).get(key);
      if (crop) {
        if (crop.state === "PLANTED" && Date.now() >= crop.readyAt)
          best = { msg: "harvestCrop", payload: { x: tx, y: ty }, label: "Harvest" };
        else if (crop.state === "PLANTED" && !crop.watered)
          best = { msg: "water", payload: { x: tx, y: ty }, label: "Water" };
        else if (crop.state === "TILLED" && me.seeds > 0)
          best = { msg: "plant", payload: { x: tx, y: ty }, label: "Plant" };
      } else if (isLandPx(tx * TILE + 28, ty * TILE + 28) && !isPond(tx, ty)) {
        best = { msg: "till", payload: { x: tx, y: ty }, label: "Till" };
      }
    }

    this.action = best;
    if (best) {
      this.prompt
        .setText(`[E] ${(best as PendingAction).label}`)
        .setVisible(true)
        .setPosition(this.scale.width / 2, this.scale.height - 60);
    } else {
      this.prompt.setVisible(false);
    }
  }

  private fireAction(): void {
    if (this.panelOpen) return; // clicks belong to the open panel
    if (this.online && this.room && this.action) {
      this.room.send(this.action.msg, this.action.payload);
    }
  }

  private updateHud(): void {
    const room = this.room;
    if (!room) return;
    const me = (room.state.players as SchemaMap<NetPlayer>).get(room.sessionId);
    if (!me) return;
    this.hud.setText(
      `🪙 ${me.coins}    ⭐ Lv ${me.level} (${me.xp}/${xpForNext(me.level)})    💎 ${me.volaPending}    ［B］Barn ［M］Market`,
    );
    this.inv.setText(
      `🌱 ${me.seeds}   🌾 ${me.feed}   🫐 ${me.berries}   🥚 ${me.eggs}   🧶 ${me.wool}   ✨ ${me.goldwool}`,
    );
  }

  // ── shop + market panels ───────────────────────────────────
  private togglePanel(which: "shop" | "market"): void {
    if (!this.online || !this.room) return;
    const opening = which === "shop" ? !this.shopPanel?.visible : !this.marketPanel?.visible;
    this.closePanels();
    if (!opening) return;
    if (which === "shop") this.shopPanel = this.buildShop();
    else this.marketPanel = this.buildMarket();
  }

  private closePanels(): void {
    this.shopPanel?.destroy();
    this.shopPanel = undefined;
    this.marketPanel?.destroy();
    this.marketPanel = undefined;
  }

  private panelShell(title: string): {
    panel: Phaser.GameObjects.Container;
    addRow: (label: string, sub: string, onClick: () => void, y: number) => void;
    width: number;
  } {
    const width = 300;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const panel = this.add.container(cx, cy).setScrollFactor(0).setDepth(6000);
    const bg = this.add
      .rectangle(0, 0, width, 340, 0xfffdf6)
      .setStrokeStyle(3, 0xe7dcc4)
      .setInteractive(); // swallow clicks
    const header = this.add
      .text(0, -148, title, {
        fontFamily: "Fredoka, sans-serif",
        fontSize: "20px",
        color: "#2a2540",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const close = this.add
      .text(width / 2 - 22, -150, "✕", { fontSize: "18px", color: "#9a8f78" })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.closePanels());
    panel.add([bg, header, close]);

    const addRow = (label: string, sub: string, onClick: () => void, y: number): void => {
      const row = this.add
        .rectangle(0, y, width - 30, 40, 0xf4eede)
        .setStrokeStyle(1, 0xe7dcc4)
        .setInteractive({ useHandCursor: true });
      row.on("pointerdown", onClick);
      const lt = this.add
        .text(-width / 2 + 24, y, label, {
          fontFamily: "Nunito, sans-serif",
          fontSize: "15px",
          color: "#2a2540",
          fontStyle: "bold",
        })
        .setOrigin(0, 0.5);
      const st = this.add
        .text(width / 2 - 24, y, sub, {
          fontFamily: "Nunito, sans-serif",
          fontSize: "14px",
          color: "#8a7f68",
        })
        .setOrigin(1, 0.5);
      panel.add([row, lt, st]);
    };

    return { panel, addRow, width };
  }

  private buildShop(): Phaser.GameObjects.Container {
    const { panel, addRow } = this.panelShell("🏚️  Barn");
    let y = -100;
    for (const item of SHOP_ITEMS) {
      addRow(item.label, `${item.price} 🪙`, () => this.room?.send("buy", { shopItemId: item.id }), y);
      y += 48;
    }
    return panel;
  }

  private buildMarket(): Phaser.GameObjects.Container {
    const { panel, addRow } = this.panelShell("🛒  Sky Market");
    const room = this.room;
    const me = room
      ? (room.state.players as SchemaMap<NetPlayer>).get(room.sessionId)
      : undefined;
    const counts: Record<string, number> = {
      BERRY: me?.berries ?? 0,
      EGG: me?.eggs ?? 0,
      WOOL: me?.wool ?? 0,
      GOLDWOOL: me?.goldwool ?? 0,
    };
    let y = -100;
    for (const item of Object.keys({ ...SELL_COINS, ...SELL_VOLA })) {
      const have = counts[item] ?? 0;
      const unit = SELL_COINS[item]
        ? `${SELL_COINS[item]} 🪙`
        : `${SELL_VOLA[item]} 💎`;
      addRow(
        `${item} ×${have}`,
        `sell all → ${unit}`,
        () => {
          if (have > 0) this.room?.send("sell", { item, qty: have });
          this.togglePanel("market"); // refresh counts
          this.togglePanel("market");
        },
        y,
      );
      y += 48;
    }
    return panel;
  }

  // ── avatars + terrain ──────────────────────────────────────
  private makeAvatar(name: string, self: boolean): Phaser.GameObjects.Container {
    const shadow = this.add.ellipse(0, 14, 26, 10, 0x000000, 0.18);
    const body = this.add.circle(0, 0, 12, self ? 0xffce4f : 0x6fb7ff).setStrokeStyle(3, 0x2a2540);
    const label = this.add
      .text(0, -26, name, {
        fontFamily: "Nunito, sans-serif",
        fontSize: "12px",
        color: "#2a2540",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    return this.add.container(0, 0, [shadow, body, label]).setDepth(1000);
  }

  private buildTerrain(): void {
    const g = this.add.graphics();
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!isLand(tx, ty)) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        if (isPond(tx, ty)) {
          g.fillStyle(0x4ea3e0, 1);
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle(0x6cc7f0, 0.5);
          g.fillRect(x + 6, y + 6, TILE - 12, 6);
          continue;
        }
        g.fillStyle(((tx + ty) & 1) === 0 ? 0x6cc05f : 0x63b657, 1);
        g.fillRect(x, y, TILE, TILE);
        if (!isLand(tx, ty - 1)) {
          g.fillStyle(0x82d172, 1);
          g.fillRect(x, y, TILE, 4);
        }
        if (!isLand(tx, ty + 1)) {
          g.fillStyle(0x8a5a3c, 1);
          g.fillRect(x, y + TILE - 12, TILE, 12);
          g.fillStyle(0x6f4630, 1);
          g.fillRect(x, y + TILE, TILE, 10);
        }
      }
    }
  }

  // ── parcels (Phase 5) ──────────────────────────────────────
  private parcelAt(px: number, py: number): NetParcel | undefined {
    const room = this.room;
    if (!room) return undefined;
    let found: NetParcel | undefined;
    (room.state.parcels as SchemaMap<NetParcel>).forEach((p) => {
      if (!found && px >= p.minX && px <= p.maxX && py >= p.minY && py <= p.maxY) found = p;
    });
    return found;
  }

  private syncParcels(): void {
    const room = this.room;
    if (!room) return;
    const parcels = room.state.parcels as SchemaMap<NetParcel> | undefined;
    if (!parcels) return;
    const g = this.parcelGfx;
    g.clear();
    const me = (room.state.players as SchemaMap<NetPlayer>).get(room.sessionId);
    const myLevel = me?.level ?? 1;
    const pulse = 0.55 + 0.35 * Math.sin(Date.now() / 500);
    const seen = new Set<number>();

    parcels.forEach((p) => {
      seen.add(p.index);
      const w = p.maxX - p.minX - 6;
      const h = p.maxY - p.minY - 6;
      let color = 0x6ee1ff;
      let alpha = pulse;
      let label = "";
      if (p.status === "OWNED") {
        const mine = p.ownerSession === room.sessionId;
        color = mine ? 0xffce4f : 0x6fb7ff;
        alpha = 0.9;
        label = mine ? "" : p.ownerName || "Pilot";
      } else if (p.status === "NPC") {
        color = 0xb07fe0;
        alpha = 0.8;
        label = p.npcName || "Neighbor";
      } else {
        // CLAIMABLE
        const locked = myLevel < p.requiredLevel;
        color = locked ? 0x9aa0aa : 0x6ee1ff;
        label = locked ? `🔒 Lv ${p.requiredLevel}` : `✦ ${p.claimCost}🪙`;
      }
      g.lineStyle(3, color, alpha);
      g.strokeRoundedRect(p.minX + 3, p.minY + 3, w, h, 10);

      // Beacon / owner label.
      let text = this.parcelLabels.get(p.index);
      if (label) {
        if (!text) {
          text = this.add
            .text(p.cx, p.cy, label, {
              fontFamily: "Fredoka, sans-serif",
              fontSize: "13px",
              color: "#ffffff",
              backgroundColor: "rgba(42,37,64,0.8)",
              padding: { x: 6, y: 2 },
            })
            .setOrigin(0.5)
            .setDepth(4);
          this.parcelLabels.set(p.index, text);
        }
        text.setText(label).setPosition(p.cx, p.cy).setVisible(true);
      } else if (text) {
        text.setVisible(false);
      }
    });

    for (const [idx, t] of this.parcelLabels) {
      if (!seen.has(idx)) {
        t.destroy();
        this.parcelLabels.delete(idx);
      }
    }
  }
}
