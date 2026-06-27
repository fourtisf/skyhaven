// $VOLA settlement (Phase 6). Transfers accrued off-chain $VOLA (volaPending)
// to a player's wallet as the SPL token on Solana devnet.
//
// Until VOLA_MINT + TREASURY_SECRET_KEY are configured this mocks the transfer
// so the settle flow is testable. The accounting (debit-pending → transfer →
// confirm → clear, with refund on failure) lives in the room and is real; only
// the chain leg is stubbed. Devnet only until Phase 7 review (§10).

import { env } from "@volari/config";

export interface TransferResult {
  signature: string;
  mock: boolean;
}

export async function transferVola(wallet: string, amount: number): Promise<TransferResult> {
  if (amount <= 0) throw new Error("amount must be positive");

  if (!env.VOLA_MINT || !env.TREASURY_SECRET_KEY) {
    // Dev/devnet mock — no chain call.
    return { signature: `mock-settle-${amount}-${Date.now().toString(36)}`, mock: true };
  }

  // Real devnet transfer. Imported lazily so dev without these deps configured
  // never pays the load cost.
  const { Connection, Keypair, PublicKey } = await import("@solana/web3.js");
  const { getOrCreateAssociatedTokenAccount, transfer } = await import("@solana/spl-token");
  const bs58 = (await import("bs58")).default;

  const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  const treasury = Keypair.fromSecretKey(bs58.decode(env.TREASURY_SECRET_KEY));
  const mint = new PublicKey(env.VOLA_MINT);
  const dest = new PublicKey(wallet);

  const fromAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mint, treasury.publicKey);
  const toAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mint, dest);

  const baseUnits = BigInt(Math.round(amount * 10 ** env.VOLA_DECIMALS));
  const signature = await transfer(
    connection,
    treasury,
    fromAta.address,
    toAta.address,
    treasury,
    baseUnits,
  );
  return { signature, mock: false };
}
