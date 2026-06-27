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
  PREMIUM_ITEMS,
  SELL_COINS,
  SELL_VOLA,
  ONBOARDING,
  DECOR_TYPES,
  xpForNext,
} from "@volari/world";
import { connectIsland } from "../net/room";

const SPEED = 190; // px/sec — matches the server (offline fallback only)
const REACH = TILE * 1.6;

// Small seeded PRNG so the decorative paths bake identically every load.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  questStep: number;
  dailyHave: number;
  dailyNeed: number;
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
interface NetBush {
  x: number;
  y: number;
  ready: boolean;
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
  private bushViews = new Map<string, Phaser.GameObjects.Container>();
  private parcelGfx!: Phaser.GameObjects.Graphics;
  private parcelLabels = new Map<number, Phaser.GameObjects.Text>();
  private decorViews = new Map<string, Phaser.GameObjects.Text>();
  private questBox!: Phaser.GameObjects.Text;
  private decorIdx = 0;
  private skyGfx!: Phaser.GameObjects.Graphics;
  private clouds: Phaser.GameObjects.Graphics[] = [];
  private windmillBlades?: Phaser.GameObjects.Graphics;

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
    this.cameras.main.setBackgroundColor("#9fd4ff");
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setZoom(1.25); // closer, cozier view (sprites read bigger)

    this.buildSky();
    this.buildBackdrop();
    this.buildTerrain();
    this.buildVillage();
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

    // Shop (Barn) / Market panels + build (decorate).
    kb.on("keydown-B", () => this.togglePanel("shop"));
    kb.on("keydown-M", () => this.togglePanel("market"));
    kb.on("keydown-G", () => this.toggleDecor());
    kb.on("keydown-ESC", () => this.closePanels());

    this.questBox = this.add
      .text(10, this.scale.height - 70, "", {
        fontFamily: "Fredoka, sans-serif",
        fontSize: "13px",
        color: "#2a2540",
        backgroundColor: "rgba(255,253,246,0.92)",
        padding: { x: 10, y: 6 },
        wordWrap: { width: 240 },
      })
      .setScrollFactor(0)
      .setDepth(5000)
      .setOrigin(0, 1);
    this.scale.on("resize", () => this.questBox.setY(this.scale.height - 70));

    // HUD / quest / prompt now live in the HTML overlay — hide the in-canvas
    // versions but keep computing them.
    [this.hud, this.inv, this.status, this.prompt, this.questBox].forEach((o) =>
      o.setVisible(false),
    );
    // Input + actions bridged from the overlay (joystick + buttons).
    this.game.events.on("ui-action", () => this.fireAction());
    this.game.events.on("ui-barn", () => this.togglePanel("shop"));
    this.game.events.on("ui-market", () => this.togglePanel("market"));
    this.game.events.on("ui-build", () => this.toggleDecor());

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

    // Drifting clouds (parallax backdrop).
    for (const c of this.clouds) {
      c.x += 7 * dt;
      if (c.x > WORLD_W + 240) c.x = -240;
    }
    if (this.windmillBlades) this.windmillBlades.rotation += dt * 0.9;

    const dx =
      (this.keys.left.isDown || this.cursors.left?.isDown ? -1 : 0) +
      (this.keys.right.isDown || this.cursors.right?.isDown ? 1 : 0);
    const dy =
      (this.keys.up.isDown || this.cursors.up?.isDown ? -1 : 0) +
      (this.keys.down.isDown || this.cursors.down?.isDown ? 1 : 0);
    // Augment keyboard with the overlay joystick vector.
    const joy = this.registry.get("joy") as { x: number; y: number } | undefined;
    let nx = dx + (joy?.x ?? 0);
    let ny = dy + (joy?.y ?? 0);
    const len = Math.hypot(nx, ny);
    if (len > 1) {
      nx /= len;
      ny /= len;
    }

    if (this.online && this.room) {
      if (nx !== this.lastSent.dx || ny !== this.lastSent.dy) {
        this.room.send("move", { dx: nx, dy: ny });
        this.lastSent = { dx: nx, dy: ny };
      }
      // Client-side prediction: move the local avatar immediately (same speed +
      // collision as the server) so input feels instant; the server stays
      // authoritative and corrects only on real divergence (see syncFromServer).
      this.stepLocal(nx, ny, dt);
      this.syncFromServer();
      this.syncParcels();
      this.syncCrops();
      this.syncDecor();
      this.syncAnimals();
      this.syncBushes();
      this.updateHud();
      this.computeAction();
      this.checkJuice();
    } else {
      this.stepLocal(nx, ny, dt);
      this.hud.setText("explore mode — connect a realtime server to farm");
    }
    this.emitHud();
  }

  // ── juice: feedback that makes actions feel good ──
  private prev?: {
    coins: number;
    berries: number;
    eggs: number;
    wool: number;
    goldwool: number;
    xp: number;
    level: number;
  };
  private audio?: AudioContext;

  private beep(freq: number, dur = 0.08, type: OscillatorType = "sine", vol = 0.18): void {
    try {
      if (!this.audio) this.audio = new AudioContext();
      const ctx = this.audio;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.stop(ctx.currentTime + dur);
    } catch {
      /* audio not available */
    }
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x, y - 18, text, {
        fontFamily: "Fredoka, sans-serif",
        fontSize: "15px",
        color,
        fontStyle: "bold",
        stroke: "#2a2540",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2000);
    this.tweens.add({
      targets: t,
      y: y - 56,
      alpha: 0,
      duration: 900,
      ease: "Cubic.out",
      onComplete: () => t.destroy(),
    });
  }

  private burst(x: number, y: number, color: number, n = 12): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + Math.random();
      const sp = 30 + Math.random() * 60;
      const c = this.add.circle(x, y, 3, color).setDepth(2000);
      this.tweens.add({
        targets: c,
        x: x + Math.cos(a) * sp,
        y: y + Math.sin(a) * sp,
        alpha: 0,
        scale: 0.2,
        duration: 450 + Math.random() * 300,
        onComplete: () => c.destroy(),
      });
    }
  }

  private checkJuice(): void {
    const room = this.room;
    if (!room) return;
    const me = (room.state.players as SchemaMap<NetPlayer>).get(room.sessionId);
    if (!me) return;
    const cur = {
      coins: me.coins,
      berries: me.berries,
      eggs: me.eggs,
      wool: me.wool,
      goldwool: me.goldwool,
      xp: me.xp,
      level: me.level,
    };
    const p = this.prev;
    const x = this.localPos.x;
    const y = this.localPos.y;
    if (p) {
      if (cur.coins > p.coins) {
        this.floatText(x, y, `+${cur.coins - p.coins} 🪙`, "#ffd54a");
        this.beep(680, 0.06, "square", 0.14);
      } else if (cur.coins < p.coins) {
        this.floatText(x, y, `${cur.coins - p.coins} 🪙`, "#ff8d6b");
      }
      if (cur.berries > p.berries) {
        this.floatText(x, y - 14, `+${cur.berries - p.berries} 🫐`, "#c9a6ff");
        this.beep(520, 0.07);
      }
      if (cur.eggs > p.eggs) {
        this.floatText(x, y - 14, `+${cur.eggs - p.eggs} 🥚`, "#fff7e6");
        this.beep(560, 0.07);
      }
      if (cur.wool > p.wool) {
        this.floatText(x, y - 14, `+${cur.wool - p.wool} 🧶`, "#fff7e6");
        this.beep(500, 0.07);
      }
      if (cur.goldwool > p.goldwool) {
        this.floatText(x, y - 32, `✨ GOLDEN WOOL!`, "#ffd54a");
        this.burst(x, y, 0xffd54a, 18);
        this.beep(880, 0.12, "triangle", 0.2);
        this.beep(1180, 0.14, "triangle", 0.15);
      }
      if (cur.level > p.level) {
        this.burst(x, y, 0xffce4f, 22);
        this.beep(660, 0.1, "triangle", 0.2);
        this.beep(880, 0.1, "triangle", 0.2);
        this.beep(1320, 0.16, "triangle", 0.18);
        this.game.events.emit("levelup", cur.level);
      }
    }
    this.prev = cur;
  }

  private lastHudAt = 0;
  private emitHud(): void {
    const now = Date.now();
    if (now - this.lastHudAt < 120) return;
    this.lastHudAt = now;
    const room = this.room;
    if (!this.online || !room) {
      this.game.events.emit("hud", { online: false });
      return;
    }
    const me = (room.state.players as SchemaMap<NetPlayer>).get(room.sessionId);
    if (!me) return;
    const step = me.questStep;
    const q = step < ONBOARDING.length ? ONBOARDING[step] : undefined;

    // Live leaderboard from connected players (competition + presence).
    const leaders: { name: string; level: number; coins: number; me: boolean }[] = [];
    (room.state.players as SchemaMap<NetPlayer>).forEach((pl, key) => {
      leaders.push({
        name: pl.name || "Pilot",
        level: pl.level,
        coins: pl.coins,
        me: key === room.sessionId,
      });
    });
    leaders.sort((a, b) => b.level - a.level || b.coins - a.coins);

    this.game.events.emit("hud", {
      playerCount: leaders.length,
      leaders: leaders.slice(0, 5),
      online: true,
      coins: me.coins,
      level: me.level,
      xp: me.xp,
      xpNext: xpForNext(me.level),
      seeds: me.seeds,
      feed: me.feed,
      berries: me.berries,
      eggs: me.eggs,
      wool: me.wool,
      goldwool: me.goldwool,
      vola: me.volaPending,
      quest: q
        ? { label: q.label, hint: q.hint, step, total: ONBOARDING.length }
        : { label: "All quests complete!", hint: "", step, total: ONBOARDING.length },
      daily: { have: me.dailyHave, need: me.dailyNeed },
      action: this.action?.label ?? "",
      playerX: me.x,
      playerY: me.y,
    });
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
        // Reconcile prediction with the server: only snap if we've genuinely
        // diverged (e.g. a rejected move), otherwise trust local prediction.
        const d = Math.hypot(this.localPos.x - p.x, this.localPos.y - p.y);
        if (d > 48) {
          this.localPos.x = p.x;
          this.localPos.y = p.y;
          this.local.setPosition(p.x, p.y);
        }
        return;
      }
      let c = this.remotes.get(key);
      if (!c) {
        c = this.makeAvatar(p.name || "Pilot", false);
        this.remotes.set(key, c);
        c.setPosition(p.x, p.y);
      }
      // Smoothly interpolate other players toward their server position.
      c.x += (p.x - c.x) * 0.3;
      c.y += (p.y - c.y) * 0.3;
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

  // ── wild berry bushes (forage) ──
  private syncBushes(): void {
    const room = this.room;
    if (!room) return;
    const bushes = room.state.bushes as SchemaMap<NetBush> | undefined;
    if (!bushes) return;
    const seen = new Set<string>();
    bushes.forEach((b, key) => {
      seen.add(key);
      let v = this.bushViews.get(key);
      if (!v) {
        v = this.makeBush();
        v.setPosition(b.x, b.y);
        this.bushViews.set(key, v);
      }
      if (v.getData("ready") !== b.ready) {
        v.setData("ready", b.ready);
        this.paintBush(v, b.ready);
      }
    });
    for (const [key, v] of this.bushViews) {
      if (!seen.has(key)) {
        v.destroy();
        this.bushViews.delete(key);
      }
    }
  }

  private makeBush(): Phaser.GameObjects.Container {
    const shadow = this.add.ellipse(0, 9, 26, 9, 0x000000, 0.16);
    const g = this.add.graphics();
    const c = this.add.container(0, 0, [shadow, g]).setDepth(700);
    c.setData("g", g);
    c.setData("ready", null);
    return c;
  }

  private paintBush(c: Phaser.GameObjects.Container, ready: boolean): void {
    const g = c.getData("g") as Phaser.GameObjects.Graphics;
    g.clear();
    g.lineStyle(2, 0x2c2440, 0.85);
    g.fillStyle(ready ? 0x4e9d4a : 0x3f7e3c, 1);
    g.fillCircle(-6, 0, 9);
    g.fillCircle(6, 0, 9);
    g.fillCircle(0, -7, 9);
    g.strokeCircle(-6, 0, 9);
    g.strokeCircle(6, 0, 9);
    g.strokeCircle(0, -7, 9);
    if (ready) {
      g.fillStyle(0x8e3bd6, 1);
      for (const [ox, oy] of [
        [-5, 2],
        [5, 1],
        [0, -4],
        [-2, -8],
      ] as const) {
        g.fillCircle(ox, oy, 2.6);
      }
    }
  }

  private makeAnimal(type: string): Phaser.GameObjects.Container {
    const shadow = this.add.ellipse(0, 12, 30, 10, 0x000000, 0.18);
    const g = this.add.graphics();
    if (type === "HEN") this.drawHen(g);
    else this.drawSheep(g, type === "AURORA");
    const produce = type === "HEN" ? "🥚" : type === "AURORA" ? "✨" : "🧶";
    const bubble = this.add
      .text(0, -28, produce, { fontSize: "16px" })
      .setOrigin(0.5)
      .setName("bubble")
      .setVisible(false);
    const hungry = this.add
      .text(-15, -22, "❗", { fontSize: "14px" })
      .setOrigin(0.5)
      .setName("hungry")
      .setVisible(false);
    return this.add.container(0, 0, [shadow, g, bubble, hungry]).setDepth(900);
  }

  private drawSheep(g: Phaser.GameObjects.Graphics, aurora: boolean): void {
    const wool = aurora ? 0xf6b8e0 : 0xffffff;
    g.lineStyle(2.4, 0x2c2440, 1);
    g.fillStyle(0x5a4636, 1);
    g.fillRect(-7, 4, 3, 7);
    g.fillRect(4, 4, 3, 7);
    g.fillStyle(wool, 1);
    g.fillCircle(0, -7, 8);
    g.fillCircle(-7, 1, 7);
    g.fillCircle(7, 1, 7);
    g.fillCircle(0, 0, 11);
    g.strokeCircle(0, 0, 11);
    g.fillStyle(0x3c3242, 1);
    g.fillEllipse(9, -1, 10, 12);
    g.strokeEllipse(9, -1, 10, 12);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(10, -2.5, 1.4);
  }

  private drawHen(g: Phaser.GameObjects.Graphics): void {
    g.lineStyle(2.4, 0x2c2440, 1);
    g.fillStyle(0xe7a23a, 1);
    g.fillRect(-3, 6, 2.4, 5);
    g.fillRect(2, 6, 2.4, 5);
    g.fillStyle(0xfff4e0, 1);
    g.fillEllipse(0, 0, 20, 18);
    g.strokeEllipse(0, 0, 20, 18);
    g.fillStyle(0xffe1b0, 1);
    g.fillEllipse(-2, 1, 10, 12);
    g.fillStyle(0xfff4e0, 1);
    g.fillCircle(7, -6, 5.5);
    g.strokeCircle(7, -6, 5.5);
    g.fillStyle(0xff6b6b, 1);
    g.fillCircle(7, -11, 2);
    g.fillStyle(0xf5a623, 1);
    g.fillTriangle(12, -6, 16, -5, 12, -3.5);
    g.fillStyle(0x3c3242, 1);
    g.fillCircle(8, -7, 1.2);
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

    // 2) Wild berry bush in reach.
    if (!best) {
      (room.state.bushes as SchemaMap<NetBush>).forEach((b, id) => {
        if (best) return;
        if (b.ready && Math.hypot(px - b.x, py - b.y) <= REACH) {
          best = { msg: "forage", payload: { id }, label: "Forage 🫐" };
        }
      });
    }

    // 3) Land claim, or farming on land you own.
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

    const step = me.questStep;
    const daily = `Daily: harvest ${me.dailyHave}/${me.dailyNeed}`;
    if (step < ONBOARDING.length) {
      const q = ONBOARDING[step];
      this.questBox.setText(`✦ QUEST: ${q?.label ?? ""}\n${q?.hint ?? ""}\n${daily}`);
    } else {
      this.questBox.setText(`⭐ All quests complete!\n${daily}`);
    }
  }

  // ── decoration (Phase 7) ───────────────────────────────────
  private syncDecor(): void {
    const room = this.room;
    if (!room) return;
    const decor = room.state.decor as
      | { forEach: (cb: (v: string, key: string) => void) => void }
      | undefined;
    if (!decor) return;
    const seen = new Set<string>();
    decor.forEach((emoji, key) => {
      seen.add(key);
      let view = this.decorViews.get(key);
      if (!view) {
        const parts = key.split(":");
        const tx = Number(parts[0]);
        const ty = Number(parts[1]);
        view = this.add
          .text(tx * TILE + TILE / 2, ty * TILE + TILE / 2, emoji, { fontSize: "26px" })
          .setOrigin(0.5)
          .setDepth(3);
        this.decorViews.set(key, view);
      }
      view.setText(emoji);
    });
    for (const [key, v] of this.decorViews) {
      if (!seen.has(key)) {
        v.destroy();
        this.decorViews.delete(key);
      }
    }
  }

  private toggleDecor(): void {
    if (!this.online || !this.room || this.panelOpen) return;
    const tx = Math.floor(this.localPos.x / TILE);
    const ty = Math.floor(this.localPos.y / TILE);
    const key = `${tx}:${ty}`;
    const decor = this.room.state.decor as { get: (k: string) => string | undefined } | undefined;
    if (decor?.get(key)) {
      this.room.send("removeDecor", { x: tx, y: ty });
    } else {
      const type = DECOR_TYPES[this.decorIdx % DECOR_TYPES.length];
      this.decorIdx += 1;
      this.room.send("placeDecor", { x: tx, y: ty, decorType: type });
    }
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
    let y = -104;
    for (const item of SHOP_ITEMS) {
      addRow(item.label, `${item.price} 🪙`, () => this.room?.send("buy", { shopItemId: item.id }), y);
      y += 44;
    }
    for (const item of PREMIUM_ITEMS) {
      addRow(
        `${item.label}  ✦`,
        `${item.volaPrice} 💎`,
        () => this.room?.send("buy", { shopItemId: item.id }),
        y,
      );
      y += 44;
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
    let y = -104;
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
      y += 44;
    }
    // Settle accrued $VOLA on-chain to the connected wallet.
    const vola = me?.volaPending ?? 0;
    addRow(
      `Settle $VOLA → wallet`,
      `${vola} 💎`,
      () => {
        if (vola > 0) this.room?.send("settleVola", {});
        this.closePanels();
      },
      y + 8,
    );
    return panel;
  }

  // ── avatars + terrain ──────────────────────────────────────
  private makeAvatar(name: string, self: boolean): Phaser.GameObjects.Container {
    const shadow = this.add.ellipse(0, 15, 24, 9, 0x000000, 0.18);
    const g = this.add.graphics();
    const shirt = self ? 0x3a6ea5 : 0x9a5bd0;
    g.lineStyle(2.4, 0x2c2440, 1);
    // legs
    g.fillStyle(0x35507a, 1);
    g.fillRect(-5, 6, 4, 8);
    g.fillRect(1, 6, 4, 8);
    // body / overalls
    g.fillStyle(shirt, 1);
    g.fillRoundedRect(-8, -4, 16, 14, 5);
    g.strokeRoundedRect(-8, -4, 16, 14, 5);
    // head
    g.fillStyle(0xf2c79a, 1);
    g.fillCircle(0, -10, 6);
    g.strokeCircle(0, -10, 6);
    // straw hat
    g.fillStyle(0xe7c463, 1);
    g.fillEllipse(0, -14, 22, 7);
    g.strokeEllipse(0, -14, 22, 7);
    g.fillStyle(0xd9ad44, 1);
    g.fillEllipse(0, -16, 12, 8);
    const label = this.add
      .text(0, -28, name, {
        fontFamily: "Nunito, sans-serif",
        fontSize: "12px",
        color: "#2a2540",
        fontStyle: "bold",
        backgroundColor: "rgba(255,253,246,0.75)",
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5);
    return this.add.container(0, 0, [shadow, g, label]).setDepth(1000);
  }

  // Deterministic per-cell hash (for scattering flowers/tufts).
  private nz(a: number, b: number): number {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  // Smooth value-noise (bilinear) so grass shades form gentle blobs, not a
  // per-tile checkerboard.
  private snoise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const tl = this.nz(xi, yi);
    const tr = this.nz(xi + 1, yi);
    const bl = this.nz(xi, yi + 1);
    const br = this.nz(xi + 1, yi + 1);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
  }

  private buildSky(): void {
    this.skyGfx = this.add.graphics().setScrollFactor(0).setDepth(-100);
    this.paintSky();
    this.scale.on("resize", () => this.paintSky());
  }

  private paintSky(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.skyGfx.clear();
    // top = deeper sky blue, bottom = pale warm horizon (matches the prototype).
    this.skyGfx.fillGradientStyle(0x6fb7ff, 0x6fb7ff, 0xcdeafe, 0xffe7c4, 1);
    this.skyGfx.fillRect(0, 0, w, h);
  }

  private buildBackdrop(): void {
    // Parallax background islands floating in the sky.
    const BG = [
      { x: 6 * TILE, y: 33 * TILE, s: 0.55, d: 0.4, tint: 0x8fb8d8 },
      { x: 46 * TILE, y: 6 * TILE, s: 0.7, d: 0.5, tint: 0xa6c8e2 },
      { x: 50 * TILE, y: 36 * TILE, s: 0.45, d: 0.32, tint: 0x86b0d4 },
      { x: 2 * TILE, y: 4 * TILE, s: 0.5, d: 0.45, tint: 0x9cc0de },
    ];
    for (const o of BG) {
      const g = this.add.graphics().setScrollFactor(o.d).setDepth(-50);
      const s = o.s;
      g.fillStyle(o.tint, 0.6);
      g.beginPath();
      g.moveTo(o.x - 70 * s, o.y);
      g.lineTo(o.x + 70 * s, o.y);
      g.lineTo(o.x + 40 * s, o.y + 80 * s);
      g.lineTo(o.x, o.y + 120 * s);
      g.lineTo(o.x - 40 * s, o.y + 78 * s);
      g.closePath();
      g.fillPath();
      g.fillStyle(o.tint, 0.9);
      g.fillEllipse(o.x, o.y, 140 * s, 40 * s);
      g.fillStyle(0xffffff, 0.25);
      g.fillEllipse(o.x, o.y - 4 * s, 132 * s, 18 * s);
    }

    // Drifting clouds.
    for (let i = 0; i < 14; i++) {
      const g = this.add.graphics().setScrollFactor(0.3).setDepth(-40);
      const s = 0.6 + (i % 5) * 0.2;
      g.fillStyle(0xffffff, 0.55);
      g.fillEllipse(0, 0, 68 * s, 36 * s);
      g.fillEllipse(-26 * s, 6 * s, 44 * s, 26 * s);
      g.fillEllipse(28 * s, 5 * s, 48 * s, 28 * s);
      g.fillEllipse(4 * s, -10 * s, 40 * s, 28 * s);
      g.setPosition((i * 397) % WORLD_W, (i * 257) % Math.floor(WORLD_H * 0.7));
      this.clouds.push(g);
    }
  }

  private buildTerrain(): void {
    const g = this.add.graphics().setDepth(0);

    // 1) Floating-island undersides first (cliff faces hanging into the sky).
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!isLand(tx, ty) || isLand(tx, ty + 1)) continue;
        const x = tx * TILE;
        const depth = TILE * 1.15 + this.nz(tx, ty) * TILE * 0.5;
        g.fillGradientStyle(0x6e5743, 0x6e5743, 0x3c2e24, 0x3c2e24, 1);
        g.fillRect(x, ty * TILE + TILE - 2, TILE + 1, depth);
      }
    }

    // 2) Grass (3-tone noise), edge highlights, tufts, pond.
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!isLand(tx, ty)) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        if (isPond(tx, ty)) {
          g.fillStyle(0x5fb8d8, 1);
          g.fillRect(x, y, TILE + 1, TILE + 1);
          g.fillStyle(0x9fe0f2, 0.5);
          g.fillRect(x, y, TILE + 1, 5);
          continue;
        }
        const n = this.snoise(tx * 0.28, ty * 0.28);
        g.fillStyle(n > 0.6 ? 0x82cf6e : n < 0.44 ? 0x64b257 : 0x74c463, 1);
        g.fillRect(x, y, TILE + 1, TILE + 1);
        if (!isLand(tx, ty - 1)) {
          g.fillStyle(0xc3f5af, 0.55);
          g.fillRect(x, y, TILE + 1, 4);
        }
        // grass tufts
        if ((tx * 3 + ty * 5) % 4 === 0) {
          g.lineStyle(1.4, 0x3c9a3c, 0.32);
          const bx = x + 12 + this.nz(tx, ty) * 30;
          const by = y + 30 + this.nz(ty, tx) * 16;
          g.beginPath();
          g.moveTo(bx, by);
          g.lineTo(bx - 2, by - 7);
          g.moveTo(bx + 4, by);
          g.lineTo(bx + 5, by - 8);
          g.strokePath();
        }
      }
    }

    // 3) Scattered flowers + pebbles (purely decorative, deterministic).
    const PETAL = [0xff7eb0, 0xffd45a, 0x9d8cff, 0xff9b6b];
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!isLand(tx, ty) || isPond(tx, ty)) continue;
        const r = this.nz(tx * 7.1, ty * 3.3);
        if (r < 0.84) continue;
        const px = x0(tx) + 10 + this.nz(tx, ty * 2) * 36;
        const py = ty * TILE + 10 + this.nz(tx * 2, ty) * 36;
        if (r > 0.94) {
          g.fillStyle(0xb9b1a0, 1);
          g.fillEllipse(px, py, 9, 6);
          g.fillStyle(0xffffff, 0.5);
          g.fillEllipse(px - 1, py - 1, 3.6, 2.2);
        } else {
          const col = PETAL[Math.floor(r * 1000) % PETAL.length] ?? 0xff7eb0;
          g.fillStyle(0x4a9d3f, 1);
          g.fillRect(px - 1, py, 2, 7);
          g.fillStyle(col, 1);
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * 6.28;
            g.fillCircle(px + Math.cos(a) * 3.2, py + Math.sin(a) * 3.2, 2.4);
          }
          g.fillStyle(0xfff0b8, 1);
          g.fillCircle(px, py, 2.2);
        }
      }
    }
    function x0(tx: number): number {
      return tx * TILE;
    }
  }

  // ── village: dirt paths + landmark buildings (ported from the prototype) ──
  private buildVillage(): void {
    const barn = this.nearestLandFree(24, 21);
    const mkt = this.nearestLandFree(30, 21);
    const wind = this.nearestLandFree(21, 25);
    const bal = this.nearestLandFree(34, 15);

    const rng = mulberry32(1337);
    const path = new Set<string>();
    this.carve(barn.x, barn.y + 2, mkt.x, mkt.y, path, rng);
    this.carve(mkt.x, mkt.y + 2, wind.x, wind.y, path, rng);
    this.paintPaths(path);

    this.placeBuilding("barn", barn.x, barn.y, 2, 2);
    this.placeBuilding("market", mkt.x, mkt.y, 2, 2);
    this.placeBuilding("windmill", wind.x, wind.y, 1, 1);
    this.placeBuilding("balloon", bal.x, bal.y, 1, 1);
  }

  private nearestLandFree(tx: number, ty: number): { x: number; y: number } {
    for (let r = 0; r < 10; r++) {
      for (let a = 0; a < 20; a++) {
        const x = Math.round(tx + Math.cos((a / 20) * 6.28) * r);
        const y = Math.round(ty + Math.sin((a / 20) * 6.28) * r);
        if (isLand(x, y) && isLand(x + 1, y) && isLand(x, y + 1) && !isPond(x, y)) {
          return { x, y };
        }
      }
    }
    return { x: tx, y: ty };
  }

  private carve(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    out: Set<string>,
    rng: () => number,
  ): void {
    let x = ax;
    let y = ay;
    let guard = 0;
    while ((x !== bx || y !== by) && guard++ < 400) {
      if (isLand(x, y)) out.add(`${x}:${y}`);
      if (rng() < 0.5) {
        if (x < bx) x++;
        else if (x > bx) x--;
      } else {
        if (y < by) y++;
        else if (y > by) y--;
      }
    }
    if (isLand(bx, by)) out.add(`${bx}:${by}`);
  }

  private paintPaths(path: Set<string>): void {
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(0xc8a06a, 1);
    path.forEach((key) => {
      const parts = key.split(":");
      const tx = Number(parts[0]);
      const ty = Number(parts[1]);
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      g.fillCircle(cx, cy, TILE * 0.42);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (path.has(`${tx + dx}:${ty + dy}`)) {
          g.fillRect(
            Math.min(cx, cx + dx * TILE) - TILE * 0.34,
            Math.min(cy, cy + dy * TILE) - TILE * 0.34,
            TILE * 0.68 + Math.abs(dx * TILE),
            TILE * 0.68 + Math.abs(dy * TILE),
          );
        }
      }
    });
  }

  private placeBuilding(type: string, tx: number, ty: number, w: number, h: number): void {
    const W = w * TILE;
    const H = h * TILE;
    const cx = tx * TILE + W / 2;
    const cy = ty * TILE + H / 2;
    const g = this.add.graphics().setDepth(5).setPosition(cx, cy);
    g.fillStyle(0x28283c, 0.16);
    g.fillEllipse(0, H / 2 - 6, W * 0.84, 24);
    if (type === "barn") this.drawBarn(g, W, H);
    else if (type === "market") this.drawMarket(g, W, H);
    else if (type === "windmill") this.drawWindmill(g, cx, cy);
    else this.drawBalloon(g);

    const label = type === "barn" ? "BARN" : type === "market" ? "MARKET" : "";
    if (label) {
      this.add
        .text(cx, cy + H * 0.5 + 6, label, {
          fontFamily: "Fredoka, sans-serif",
          fontSize: "11px",
          color: "#2c2440",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(6);
    }
    if (type === "market") {
      this.add.text(cx, cy + H * 0.25, "☁️🥚🫐", { fontSize: "15px" }).setOrigin(0.5).setDepth(6);
    }
  }

  private drawBarn(g: Phaser.GameObjects.Graphics, W: number, H: number): void {
    const Wb = W * 0.78;
    const Hb = H * 0.62;
    const x = -Wb / 2;
    const y = -Hb * 0.2;
    g.lineStyle(2.4, 0x2c2440, 1);
    g.fillStyle(0xe7563f, 1);
    g.fillRoundedRect(x, y, Wb, Hb, 6);
    g.strokeRoundedRect(x, y, Wb, Hb, 6);
    g.fillStyle(0xb23a2c, 1);
    g.fillTriangle(x - 8, y, x + Wb / 2, y - Hb * 0.5, x + Wb + 8, y);
    g.strokeTriangle(x - 8, y, x + Wb / 2, y - Hb * 0.5, x + Wb + 8, y);
    g.fillStyle(0xf3e6c8, 1);
    g.fillRoundedRect(x + Wb / 2 - 12, y + Hb - 24, 24, 24, 3);
    g.strokeRoundedRect(x + Wb / 2 - 12, y + Hb - 24, 24, 24, 3);
    g.lineStyle(2, 0xc98a4a, 1);
    g.beginPath();
    g.moveTo(x + Wb / 2, y + Hb - 24);
    g.lineTo(x + Wb / 2, y + Hb - 2);
    g.moveTo(x + Wb / 2 - 12, y + Hb - 12);
    g.lineTo(x + Wb / 2 + 12, y + Hb - 12);
    g.strokePath();
    g.lineStyle(2.4, 0x2c2440, 1);
    g.fillStyle(0xcfd6dd, 1);
    g.fillRoundedRect(x + Wb - 2, y - 6, 16, Hb + 6, 4);
    g.strokeRoundedRect(x + Wb - 2, y - 6, 16, Hb + 6, 4);
    g.fillStyle(0x9aa6b0, 1);
    g.fillCircle(x + Wb + 6, y - 6, 8);
    g.strokeCircle(x + Wb + 6, y - 6, 8);
  }

  private drawMarket(g: Phaser.GameObjects.Graphics, W: number, H: number): void {
    const Wm = W * 0.8;
    const Hm = H * 0.5;
    const x = -Wm / 2;
    const y = 0;
    g.lineStyle(2.4, 0x2c2440, 1);
    g.fillStyle(0xcaa477, 1);
    g.fillRoundedRect(x, y, Wm, Hm, 5);
    g.strokeRoundedRect(x, y, Wm, Hm, 5);
    g.fillStyle(0xa9824f, 1);
    g.fillRoundedRect(x + 6, y + Hm - 16, Wm - 12, 14, 3);
    const ay = y - Hm * 0.7;
    for (let i = 0; i < 6; i++) {
      g.fillStyle(i % 2 ? 0xff8d6b : 0xfff3e0, 1);
      const x1 = x - 6 + (i * (Wm + 12)) / 6;
      const x2 = x - 6 + ((i + 1) * (Wm + 12)) / 6;
      const xm = x - 6 + ((i + 0.5) * (Wm + 12)) / 6;
      g.fillTriangle(x1, ay, x2, ay, xm, ay + 16);
    }
    g.lineStyle(2.4, 0x2c2440, 1);
    g.beginPath();
    g.moveTo(x - 6, ay);
    g.lineTo(x + Wm + 6, ay);
    g.strokePath();
  }

  private drawWindmill(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    g.lineStyle(2.4, 0x2c2440, 1);
    g.fillStyle(0xefe3c8, 1);
    g.fillRoundedRect(-13, -6, 26, 40, 4);
    g.strokeRoundedRect(-13, -6, 26, 40, 4);
    g.fillStyle(0xd8c79e, 1);
    g.fillRoundedRect(-13, 22, 26, 12, 3);
    g.fillStyle(0x9c6b3f, 1);
    g.fillTriangle(-16, -6, 0, -22, 16, -6);
    g.strokeTriangle(-16, -6, 0, -22, 16, -6);

    const blades = this.add.graphics().setDepth(6).setPosition(cx, cy - 2);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const p = (lx: number, ly: number): [number, number] => [lx * c - ly * s, lx * s + ly * c];
      const [x1, y1] = p(0, 0);
      const [x2, y2] = p(4, -26);
      const [x3, y3] = p(-3, -26);
      g.lineStyle(2.4, 0x2c2440, 1);
      blades.fillStyle(0xffffff, 1);
      blades.lineStyle(2.4, 0x2c2440, 1);
      blades.fillTriangle(x1, y1, x2, y2, x3, y3);
      blades.strokeTriangle(x1, y1, x2, y2, x3, y3);
    }
    blades.fillStyle(0x5b4a32, 1);
    blades.fillCircle(0, 0, 3.5);
    this.windmillBlades = blades;
  }

  private drawBalloon(g: Phaser.GameObjects.Graphics): void {
    g.lineStyle(2.4, 0x2c2440, 1);
    g.fillStyle(0xa9824f, 1);
    g.fillRoundedRect(-9, 10, 18, 12, 3);
    g.strokeRoundedRect(-9, 10, 18, 12, 3);
    g.lineStyle(1.4, 0x7a6a4a, 1);
    g.beginPath();
    g.moveTo(-7, 10);
    g.lineTo(-10, -18);
    g.moveTo(7, 10);
    g.lineTo(10, -18);
    g.strokePath();
    g.lineStyle(2.4, 0x2c2440, 1);
    g.fillStyle(0xffb0c4, 1);
    g.fillEllipse(0, -26, 44, 56);
    g.strokeEllipse(0, -26, 44, 56);
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
