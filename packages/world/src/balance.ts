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
