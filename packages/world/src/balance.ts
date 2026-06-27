// Game balance constants — single source of truth for timers (and later,
// prices). Phase 1 only needs timers for seeding starter animals.
//
// Production timers per docs/VOLARI_HANDOFF.md §8 (tune in playtests). The
// prototype's demo-fast values are kept for quick local testing — Phase 7
// rebalances to the production set before any real value is attached.

export const TIMERS = {
  henEggMs: 30 * 60 * 1000, // §8: 20–45 min
  sheepWoolMs: 2 * 60 * 60 * 1000, // §8: 1–3 h
  cropWateredMs: 3 * 60 * 60 * 1000, // §8: 2–6 h
  cropUnwateredMs: 9 * 60 * 60 * 1000, // §8: much slower / stalls
  hungerMs: 8 * 60 * 60 * 1000, // §8: 6–12 h
  berryMs: 45 * 60 * 1000, // §8: 30–60 min
} as const;

/** Prototype demo-fast values (≈60s loop) — for local testing only. */
export const DEMO_TIMERS = {
  henEggMs: 9_000,
  sheepWoolMs: 12_000,
  cropWateredMs: 15_000,
  cropUnwateredMs: 43_000,
  hungerMs: 34_000,
  berryMs: 16_000,
} as const;

export type Timers = typeof TIMERS;

// ── Economy (Phase 4) — server-owned prices. The client reads these for
//    display only; the server is authoritative on every debit/credit. ──

/** Sell value in coins for soft-currency goods (Sky Market). */
export const SELL_COINS: Record<string, number> = {
  BERRY: 4,
  EGG: 6,
  WOOL: 12,
};

/** Golden Wool is the only soft good that accrues $VOLA (§5), settled Phase 6. */
export const SELL_VOLA: Record<string, number> = {
  GOLDWOOL: 1,
};

export interface ShopItem {
  id: string;
  label: string;
  kind: "seeds" | "feed" | "animal";
  amount: number;
  animalType?: "HEN" | "SHEEP";
  price: number; // coins
}

/** Barn shop catalog. */
export const SHOP_ITEMS: ShopItem[] = [
  { id: "seeds5", label: "Seeds ×5", kind: "seeds", amount: 5, price: 20 },
  { id: "feed5", label: "Feed ×5", kind: "feed", amount: 5, price: 15 },
  { id: "hen", label: "Hen", kind: "animal", amount: 1, animalType: "HEN", price: 60 },
  { id: "sheep", label: "Sheep", kind: "animal", amount: 1, animalType: "SHEEP", price: 120 },
];

export interface PremiumItem {
  id: string;
  label: string;
  animalType: "AURORA";
  amount: number;
  volaPrice: number; // priced in $VOLA (off-chain volaPending; settle on-chain)
}

/** Premium catalog — bought with $VOLA (Golden Wool / milestone rewards). */
export const PREMIUM_ITEMS: PremiumItem[] = [
  { id: "aurora", label: "Aurora Sheep", animalType: "AURORA", amount: 1, volaPrice: 3 },
];

/** XP needed to advance FROM the given level. */
export function xpForNext(level: number): number {
  return 60 + (level - 1) * 40;
}

export const XP = {
  harvestCrop: 3,
  harvestAnimal: 5,
  sell: 1,
  buyAnimal: 8,
} as const;

// ── Quests + decoration (Phase 7) ──────────────────────────────

export interface QuestDef {
  id: string;
  label: string;
  hint: string;
  flag: string; // gameplay flag that completes it
  rewardCoins: number;
  rewardXp: number;
}

/** Onboarding chain — server validates completion from gameplay flags. */
export const ONBOARDING: QuestDef[] = [
  { id: "claim", label: "Claim a sky plot", hint: "Stand in a cyan plot and press E", flag: "claimed", rewardCoins: 0, rewardXp: 10 },
  { id: "plant", label: "Plant your first seed", hint: "Till your land (E), then plant", flag: "planted", rewardCoins: 10, rewardXp: 5 },
  { id: "harvest", label: "Harvest a crop", hint: "Water it, wait, then harvest", flag: "harvested", rewardCoins: 12, rewardXp: 5 },
  { id: "animal", label: "Collect from an animal", hint: "Stand by your hen/sheep and press E", flag: "collected", rewardCoins: 10, rewardXp: 5 },
  { id: "sell", label: "Sell at the Sky Market", hint: "Press M and sell goods", flag: "sold", rewardCoins: 8, rewardXp: 5 },
  { id: "decorate", label: "Decorate your island", hint: "Press G on your land", flag: "decorated", rewardCoins: 15, rewardXp: 5 },
];

/** Daily quest reward (harvest N → coins + a little $VOLA). */
export const DAILY = { type: "harvest", need: 5, rewardCoins: 25, rewardVola: 1 } as const;

export const DECOR_COST = 20;
export const DECOR_TYPES = ["🌷", "🌳", "🪵", "⛲", "🏺"] as const;
