import { Client, type Room } from "colyseus.js";

export interface JoinOptions {
  name?: string;
  wallet?: string;
}

/**
 * Connect to the authoritative island room. Resolves with the joined Room, or
 * rejects if the realtime server is unreachable (the scene then falls back to
 * offline/local movement so the island stays explorable before the realtime
 * service is deployed).
 */
export async function connectIsland(url: string, options: JoinOptions = {}): Promise<Room> {
  const client = new Client(url);
  return client.joinOrCreate("island", options);
}
