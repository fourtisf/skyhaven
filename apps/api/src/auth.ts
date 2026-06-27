import { randomBytes } from "node:crypto";
import { env } from "@volari/config";
import bs58 from "bs58";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import nacl from "tweetnacl";

export interface AuthToken {
  wallet: string;
}

/** Message a wallet signs to prove ownership. */
export function authMessage(wallet: string, nonce: string): string {
  return `Volari authentication\nwallet: ${wallet}\nnonce: ${nonce}`;
}

export function issueToken(wallet: string): string {
  const options: jwt.SignOptions = {
    expiresIn: env.AUTH_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  };
  return jwt.sign({ wallet } satisfies AuthToken, env.AUTH_SECRET, options);
}

export function verifyToken(token: string): AuthToken | null {
  try {
    const decoded = jwt.verify(token, env.AUTH_SECRET);
    if (typeof decoded === "object" && decoded && typeof decoded.wallet === "string") {
      return { wallet: decoded.wallet };
    }
    return null;
  } catch {
    return null;
  }
}

// Short-lived nonce store. Redis-backed in production; in-memory is fine for a
// single api instance during development.
const NONCE_TTL_MS = 5 * 60 * 1000;
const nonces = new Map<string, { nonce: string; exp: number }>();

function isValidWallet(wallet: string): boolean {
  try {
    return typeof wallet === "string" && bs58.decode(wallet).length === 32;
  } catch {
    return false;
  }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  // 1) Request a nonce to sign.
  app.post<{ Body: { wallet?: string } }>("/auth/nonce", async (req, reply) => {
    const wallet = req.body?.wallet ?? "";
    if (!isValidWallet(wallet)) {
      reply.code(400);
      return { error: "invalid_wallet" };
    }
    const nonce = randomBytes(16).toString("hex");
    nonces.set(wallet, { nonce, exp: Date.now() + NONCE_TTL_MS });
    return { nonce, message: authMessage(wallet, nonce) };
  });

  // 2) Verify the signed nonce → issue a session token.
  app.post<{ Body: { wallet?: string; signature?: string } }>(
    "/auth/verify",
    async (req, reply) => {
      const wallet = req.body?.wallet ?? "";
      const signature = req.body?.signature ?? "";
      const entry = nonces.get(wallet);
      if (!isValidWallet(wallet) || !entry || entry.exp < Date.now()) {
        reply.code(400);
        return { error: "no_valid_nonce" };
      }
      let ok = false;
      try {
        ok = nacl.sign.detached.verify(
          new TextEncoder().encode(authMessage(wallet, entry.nonce)),
          bs58.decode(signature),
          bs58.decode(wallet),
        );
      } catch {
        ok = false;
      }
      if (!ok) {
        reply.code(401);
        return { error: "bad_signature" };
      }
      nonces.delete(wallet); // single-use
      return { token: issueToken(wallet), wallet };
    },
  );

  // 3) Whoami — validate a bearer token.
  app.get("/auth/me", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const auth = verifyToken(token);
    if (!auth) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    return { wallet: auth.wallet };
  });
}
