// Deterministic Volari world model — ported from the prototype (docs/volari.html).
//
// Pure functions, no DB. Shared by the Phase 1 seed and (Phase 2) the
// authoritative IslandRoom so server-side land/parcel/movement validation
// matches exactly what players see. The land mask and parcel layout are fully
// deterministic (hash-noise, no RNG), so the server can reproduce them.

export const TILE = 56;
export const COLS = 54;
export const ROWS = 40;
export const PS = 5; // parcel size in tiles (PS × PS)
export const PCOLS = Math.ceil(COLS / PS);
export const PROWS = Math.ceil(ROWS / PS);
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

/** Island center (spawn anchor) in tile coords. */
export const CENTER = { x: 27, y: 20 } as const;

const BLOBS = [
  { cx: 27, cy: 20, r: 14 },
  { cx: 13, cy: 13, r: 6.5 },
  { cx: 42, cy: 29, r: 8 },
  { cx: 20, cy: 16, r: 5 },
  { cx: 35, cy: 24, r: 5 },
];

const POND = { cx: 31, cy: 17, rx: 2.4, ry: 1.7 };

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const tl = hash(xi, yi);
  const tr = hash(xi + 1, yi);
  const bl = hash(xi, yi + 1);
  const br = hash(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}

function fbm(x: number, y: number): number {
  return vnoise(x, y) * 0.6 + vnoise(x * 2, y * 2) * 0.3 + vnoise(x * 4, y * 4) * 0.1;
}

function blobField(tx: number, ty: number): number {
  let b = 999;
  for (const o of BLOBS) {
    const dx = tx - o.cx;
    const dy = (ty - o.cy) * 1.04;
    const d = Math.sqrt(dx * dx + dy * dy) - o.r;
    if (d < b) b = d;
  }
  return b;
}

// Build the land mask once at module load (deterministic).
const land = new Uint8Array(COLS * ROWS);
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const e = (fbm(x * 0.17 + 11.2, y * 0.17 + 4.7) - 0.5) * 5.0;
    land[y * COLS + x] = blobField(x, y) + e < 0 ? 1 : 0;
  }
}

export function isLand(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  return (land[ty * COLS + tx] ?? 0) > 0;
}

export function isLandPx(px: number, py: number): boolean {
  return isLand(Math.floor(px / TILE), Math.floor(py / TILE));
}

export function isPond(tx: number, ty: number): boolean {
  const dx = (tx - POND.cx) / POND.rx;
  const dy = (ty - POND.cy) / POND.ry;
  return dx * dx + dy * dy < 1 && isLand(tx, ty);
}

/** Spawn point in pixels — nearest land spiraling out from center. */
export const SPAWN: { x: number; y: number } = (() => {
  for (let r = 0; r < 12; r++) {
    for (let a = 0; a < 16; a++) {
      const tx = Math.round(CENTER.x + Math.cos((a / 16) * 6.28) * r);
      const ty = Math.round(CENTER.y + Math.sin((a / 16) * 6.28) * r);
      if (isLand(tx, ty)) return { x: tx * TILE + 28, y: ty * TILE + 28 };
    }
  }
  return { x: CENTER.x * TILE + 28, y: CENTER.y * TILE + 28 };
})();

export const NPC_NAMES = ["Bima", "Sari", "Dewi", "Rangga", "Putri", "Adi"] as const;

export type ParcelOwner = "you" | "npc" | "none";

export interface WorldTile {
  localX: number;
  localY: number;
  worldX: number;
  worldY: number;
}

export interface WorldParcel {
  index: number;
  gridX: number;
  gridY: number;
  centerX: number; // tile coords
  centerY: number;
  distance: number;
  owner: ParcelOwner;
  npcName: string | null;
  claimCost: number;
  requiredLevel: number;
  tiles: WorldTile[];
}

/**
 * Generate parcels deterministically (mirrors prototype lines 167-178):
 * group land tiles into PS×PS parcels, sort by distance from center, then
 * assign the starter parcel (index 0), three NPC parcels (indices 2/4/6), and
 * escalating claimCost/requiredLevel on the rest.
 */
export function generateParcels(): WorldParcel[] {
  type Base = Omit<WorldParcel, "owner" | "npcName" | "claimCost" | "requiredLevel">;
  const base: Base[] = [];

  for (let py = 0; py < PROWS; py++) {
    for (let px = 0; px < PCOLS; px++) {
      const tiles: WorldTile[] = [];
      for (let y = py * PS; y < Math.min(ROWS, py * PS + PS); y++) {
        for (let x = px * PS; x < Math.min(COLS, px * PS + PS); x++) {
          if (isLand(x, y)) {
            tiles.push({ localX: x - px * PS, localY: y - py * PS, worldX: x, worldY: y });
          }
        }
      }
      if (tiles.length === 0) continue; // skip all-sky parcels
      const cx = px * PS + PS / 2;
      const cy = py * PS + PS / 2;
      base.push({
        index: 0,
        gridX: px,
        gridY: py,
        centerX: cx,
        centerY: cy,
        distance: Math.hypot(cx - CENTER.x, cy - CENTER.y),
        tiles,
      });
    }
  }

  base.sort((a, b) => a.distance - b.distance);

  let npcSet = 0;
  return base.map((p, i): WorldParcel => {
    if (i === 0) {
      return { ...p, index: i, owner: "you", npcName: null, claimCost: 0, requiredLevel: 1 };
    }
    if ((i === 2 || i === 4 || i === 6) && npcSet < 3) {
      const npcName = NPC_NAMES[npcSet % NPC_NAMES.length] ?? "Neighbor";
      npcSet++;
      return { ...p, index: i, owner: "npc", npcName, claimCost: 0, requiredLevel: 1 };
    }
    return {
      ...p,
      index: i,
      owner: "none",
      npcName: null,
      claimCost: 40 + Math.floor(i / 2) * 35,
      requiredLevel: 1 + Math.floor(i / 4),
    };
  });
}
