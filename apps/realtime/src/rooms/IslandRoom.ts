import { Room, type Client } from "@colyseus/core";
import { isLandPx, SPAWN, WORLD_W, WORLD_H } from "@volari/world";
import { IslandState, Player } from "./schema.js";

const SPEED = 190; // px/sec — server-owned movement speed
const TICK_HZ = 30;

interface JoinOptions {
  name?: string;
  wallet?: string;
}

interface MoveMessage {
  dx?: number;
  dy?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Authoritative island room (Phase 2).
 *
 * The world (land mask) is the deterministic @volari/world model — identical
 * to what the Phase 1 seed wrote to Postgres — so the server validates
 * movement against land without a DB round-trip. The client sends only input
 * intent; the server integrates position, rejects moves onto sky/out-of-bounds
 * (teleport/speed guard, §6), and broadcasts state diffs.
 *
 * Phase 3+ layers farming/animals and persists mutations through @volari/db.
 */
export class IslandRoom extends Room<IslandState> {
  override maxClients = 30;

  override onCreate(): void {
    this.setState(new IslandState());

    this.onMessage("move", (client, message: MoveMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      let dx = Number(message?.dx) || 0;
      let dy = Number(message?.dy) || 0;
      // Never trust magnitude — normalize to a unit vector at most.
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      p.inx = dx;
      p.iny = dy;
    });

    this.setSimulationInterval((dt) => this.tick(dt), 1000 / TICK_HZ);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const p = new Player();
    p.x = SPAWN.x;
    p.y = SPAWN.y;
    p.name = (options.name ?? "Pilot").slice(0, 16);
    p.wallet = (options.wallet ?? "").slice(0, 64);
    this.state.players.set(client.sessionId, p);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }

  private tick(dtMs: number): void {
    const dt = dtMs / 1000;
    this.state.players.forEach((p) => {
      if (p.inx === 0 && p.iny === 0) return;
      const nx = p.x + p.inx * SPEED * dt;
      const ny = p.y + p.iny * SPEED * dt;
      // Axis-separated collision so sliding along cliffs feels natural; only
      // land tiles are walkable.
      if (isLandPx(nx, p.y)) p.x = clamp(nx, 0, WORLD_W);
      if (isLandPx(p.x, ny)) p.y = clamp(ny, 0, WORLD_H);
    });
  }
}
