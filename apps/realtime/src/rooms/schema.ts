import { Schema, MapSchema, type } from "@colyseus/schema";

/** A connected player. Position is authoritative — set only by the server. */
export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  // Last input vector (-1..1 each axis); the client sends intent, never position.
  @type("number") inx = 0;
  @type("number") iny = 0;
  @type("string") name = "";
  @type("string") wallet = "";
}

export class IslandState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
