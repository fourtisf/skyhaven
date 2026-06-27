import Phaser from "phaser";
import { IslandScene } from "./scenes/IslandScene";

export interface CreateGameOptions {
  /** DOM element (or its id) the canvas mounts into. */
  parent: HTMLElement | string;
  width?: number;
  height?: number;
  /** Colyseus realtime URL, e.g. ws://localhost:2567. Omit for offline mode. */
  serverUrl?: string;
  /** Display name for this player. */
  playerName?: string;
}

/**
 * Boot the Volari Phaser game. Call this from the web shell on the client side
 * only (Phaser needs `window`); see apps/web for the dynamic, SSR-safe mount.
 */
export function createGame(options: CreateGameOptions): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: options.parent,
    width: options.width ?? 960,
    height: options.height ?? 600,
    backgroundColor: "#bfe6ff",
    pixelArt: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [IslandScene],
    callbacks: {
      preBoot: (game) => {
        game.registry.set("serverUrl", options.serverUrl ?? "");
        game.registry.set("playerName", options.playerName ?? "Pilot");
      },
    },
  };

  return new Phaser.Game(config);
}

export { IslandScene };
