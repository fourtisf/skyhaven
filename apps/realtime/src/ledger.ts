// Audit trail for every balance change (§6). In-memory for now (Phase 4 runs
// without a DB); the same call site persists to LedgerEntry via @volari/db once
// the database is wired. Keeping it centralized means there is exactly one
// place that records coin/$VOLA deltas — required for later reconciliation.

export interface LedgerRecord {
  userId: string; // sessionId (or DB user id once persisted)
  kind: string; // SELL | BUY | HARVEST | QUEST | VOLA_SETTLE ...
  coinDelta: number;
  volaDelta: number;
  meta: Record<string, unknown>;
  at: number;
}

const MAX = 5000;
const entries: LedgerRecord[] = [];

export function recordLedger(
  userId: string,
  kind: string,
  coinDelta: number,
  volaDelta: number,
  meta: Record<string, unknown> = {},
): void {
  const rec: LedgerRecord = { userId, kind, coinDelta, volaDelta, meta, at: Date.now() };
  entries.push(rec);
  if (entries.length > MAX) entries.shift();
  // TODO(Phase 4 persistence): await prisma.ledgerEntry.create({ data: ... }).
  if (coinDelta !== 0 || volaDelta !== 0) {
    console.log(
      `[ledger] ${userId} ${kind} coins${coinDelta >= 0 ? "+" : ""}${coinDelta} ` +
        `vola${volaDelta >= 0 ? "+" : ""}${volaDelta} ${JSON.stringify(meta)}`,
    );
  }
}

export function ledgerFor(userId: string): LedgerRecord[] {
  return entries.filter((e) => e.userId === userId);
}
