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
  generateParcels,
} from "@volari/world";
import { connectIsland } from "../net/room";

const SPEED = 190; // px/sec — must match the server (offline fallback only)

interface NetPlayer {
  x: number;
  y: number;
  name: string;
}

/**
 * IslandScene (Phase 2) — renders the floating island + players and drives
 * movement. When the realtime server is reachable it is fully authoritative
 * (input → intent → server → state). When it is not (e.g. before the realtime
 * service is deployed) it falls back to local, collision-checked movement so
 * the island stays explorable.
 */
export class IslandScene extends Phaser.Scene {
  private room?: Room;
  private online = false;

  private local!: Phaser.GameObjects.Container;
  private localPos = { x: SPAWN.x, y: SPAWN.y };
  private remotes = new Map<string, Phaser.GameObjects.Container>();

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private lastSent = { dx: 0, dy: 0 };
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super("island");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#bfe6ff");
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

    this.buildTerrain();
    this.buildParcelHints();

    this.local = this.makeAvatar("You", true);
    this.local.setPosition(this.localPos.x, this.localPos.y);
    this.cameras.main.startFollow(this.local, true, 0.12, 0.12);

    const kb = this.input.keyboard!;
    this.keys = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    kb.addKeys({ up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT" }); // arrows too
    this.cursors = kb.createCursorKeys();

    this.status = this.add
      .text(10, 10, "connecting…", {
        fontFamily: "Nunito, sans-serif",
        fontSize: "13px",
        color: "#2a2540",
        backgroundColor: "rgba(255,253,246,0.8)",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(5000);

    void this.connect();
  }

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private async connect(): Promise<void> {
    const url = (this.registry.get("serverUrl") as string | undefined) ?? "";
    if (!url) {
      this.status.setText("offline (no server url) · WASD to move");
      return;
    }
    try {
      const name = (this.registry.get("playerName") as string | undefined) ?? "Pilot";
      const room = await connectIsland(url, { name });
      this.room = room;
      this.online = true;
      this.status.setText("online · WASD to move");
      room.onLeave(() => {
        this.online = false;
        this.status.setText("disconnected · offline (WASD)");
      });
    } catch {
      this.status.setText("offline (server unreachable) · WASD to move");
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

    // Normalize diagonals.
    let nx = dx;
    let ny = dy;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      nx /= len;
      ny /= len;
    }

    if (this.online && this.room) {
      // Authoritative: send intent on change, render own + remote players from state.
      if (nx !== this.lastSent.dx || ny !== this.lastSent.dy) {
        this.room.send("move", { dx: nx, dy: ny });
        this.lastSent = { dx: nx, dy: ny };
      }
      this.syncFromServer();
    } else {
      // Offline fallback: integrate locally with the same land collision.
      this.stepLocal(nx, ny, dt);
    }
  }

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
    const players = room.state.players as
      | { forEach: (cb: (p: NetPlayer, key: string) => void) => void }
      | undefined;
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

    // Drop players who left.
    for (const [key, c] of this.remotes) {
      if (!seen.has(key)) {
        c.destroy();
        this.remotes.delete(key);
      }
    }
  }

  private makeAvatar(name: string, self: boolean): Phaser.GameObjects.Container {
    const body = this.add
      .circle(0, 0, 12, self ? 0xffce4f : 0x6fb7ff)
      .setStrokeStyle(3, 0x2a2540);
    const shadow = this.add.ellipse(0, 14, 26, 10, 0x000000, 0.18);
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

        // Grass with a subtle checker.
        g.fillStyle(((tx + ty) & 1) === 0 ? 0x6cc05f : 0x63b657, 1);
        g.fillRect(x, y, TILE, TILE);

        // Top highlight where the tile above is sky.
        if (!isLand(tx, ty - 1)) {
          g.fillStyle(0x82d172, 1);
          g.fillRect(x, y, TILE, 4);
        }
        // Cliff/underside where the tile below is sky → floating-island look.
        if (!isLand(tx, ty + 1)) {
          g.fillStyle(0x8a5a3c, 1);
          g.fillRect(x, y + TILE - 12, TILE, 12);
          g.fillStyle(0x6f4630, 1);
          g.fillRect(x, y + TILE, TILE, 10);
        }
      }
    }
  }

  /** Light gold outline around the starter parcel so spawn reads as "yours". */
  private buildParcelHints(): void {
    const owned = generateParcels().find((p) => p.owner === "you");
    if (!owned || owned.tiles.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of owned.tiles) {
      minX = Math.min(minX, t.worldX * TILE);
      minY = Math.min(minY, t.worldY * TILE);
      maxX = Math.max(maxX, t.worldX * TILE + TILE);
      maxY = Math.max(maxY, t.worldY * TILE + TILE);
    }
    this.add
      .graphics()
      .lineStyle(3, 0xffce4f, 0.9)
      .strokeRoundedRect(minX + 2, minY + 2, maxX - minX - 4, maxY - minY - 4, 10)
      .setDepth(2);
  }
}
