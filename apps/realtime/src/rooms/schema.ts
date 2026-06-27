import { Schema, MapSchema, type } from "@colyseus/schema";

/** A connected player. Position + inventory are authoritative (server-set). */
export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  // Last input vector (-1..1 each axis); the client sends intent, never position.
  @type("number") inx = 0;
  @type("number") iny = 0;
  @type("string") name = "";
  @type("string") wallet = "";

  // Phase 3 inventory.
  @type("number") seeds = 6;
  @type("number") feed = 5;
  @type("number") berries = 0;
  @type("number") eggs = 0;
  @type("number") wool = 0;
  @type("number") goldwool = 0;

  // Phase 4 economy + progression.
  @type("number") coins = 55;
  @type("number") xp = 0;
  @type("number") level = 1;
  @type("number") volaPending = 0; // off-chain $VOLA; on-chain settle is Phase 6
  @type("number") animalCap = 6;
}

/** A tilled/planted tile. Absent key = plain grass. Key = "worldX:worldY". */
export class Crop extends Schema {
  @type("string") state = "TILLED"; // TILLED | PLANTED
  @type("string") cropType = "";
  @type("number") plantedAt = 0; // epoch ms
  @type("number") readyAt = 0; // epoch ms (server-computed)
  @type("boolean") watered = false;
  @type("number") worldX = 0;
  @type("number") worldY = 0;
}

/** A produce animal owned by a player. Key = animal id. */
export class Animal extends Schema {
  @type("string") owner = ""; // sessionId of the owner
  @type("string") type = "HEN"; // HEN | SHEEP | AURORA
  @type("number") x = 0;
  @type("number") y = 0;
  @type("boolean") fed = true;
  @type("number") hungerAt = 0; // becomes hungry at this epoch ms
  @type("number") produceReadyAt = 0; // epoch ms
  @type("boolean") hasProduce = false;
}

/** A land parcel. Ownership is authoritative; the deed is a Volari Deed cNFT. */
export class Parcel extends Schema {
  @type("number") index = 0;
  @type("string") status = "CLAIMABLE"; // LOCKED | CLAIMABLE | OWNED | NPC
  @type("string") ownerSession = "";
  @type("string") ownerName = "";
  @type("string") npcName = "";
  @type("number") claimCost = 0;
  @type("number") requiredLevel = 1;
  @type("string") deedAssetId = "";
  // Bounding box + centroid in pixels for client borders/beacons.
  @type("number") minX = 0;
  @type("number") minY = 0;
  @type("number") maxX = 0;
  @type("number") maxY = 0;
  @type("number") cx = 0;
  @type("number") cy = 0;
}

export class IslandState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Crop }) crops = new MapSchema<Crop>();
  @type({ map: Animal }) animals = new MapSchema<Animal>();
  @type({ map: Parcel }) parcels = new MapSchema<Parcel>();
}
