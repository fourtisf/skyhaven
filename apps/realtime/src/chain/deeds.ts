// Volari Deed minting (Phase 5). A parcel claim mints a Metaplex Bubblegum
// compressed NFT (cNFT) on Solana devnet via Helius.
//
// Until HELIUS_API_KEY + a tree/collection are configured, this returns a mock
// asset id so the claim flow is fully playable. The claim UX must NOT block on
// chain confirmation (§10): the server sets status OWNED immediately and fills
// deedAssetId when the mint resolves (optimistic claim, reconcile on webhook).

export interface DeedMintResult {
  assetId: string;
  mock: boolean;
}

export interface DeedMintRequest {
  wallet: string;
  parcelIndex: number;
  gridX: number;
  gridY: number;
}

export async function mintDeed(req: DeedMintRequest): Promise<DeedMintResult> {
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    // Dev/devnet mock — deterministic-ish placeholder asset id.
    const id = `mock-deed-${req.parcelIndex}-${req.gridX}x${req.gridY}`;
    return { assetId: id, mock: true };
  }

  // TODO(Phase 5 real mint): mint a compressed NFT to req.wallet using
  // @metaplex-foundation/mpl-bubblegum + a Helius RPC connection on devnet,
  // against a pre-created merkle tree + collection. Return the minted asset id;
  // a POST /deed/mint-callback Helius webhook confirms + reconciles it.
  // For now, fall back to a mock so the claim flow stays unblocked.
  const id = `pending-deed-${req.parcelIndex}-${req.gridX}x${req.gridY}`;
  return { assetId: id, mock: true };
}
