import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";

export interface CreateGameOptions {
  /** DOM element (or its id) the canvas mounts into. */
  parent: HTMLElement | string;
  width?: number;
  height?: number;
}

/**
 * Boot the Volari Phaser game. Call this from the web shell on the client
 * side only (Phaser needs `window`); see apps/web for the dynamic, SSR-safe
 * mount.
 */
export function createGame(options: CreateGameOptions): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: options.parent,
    width: options.width ?? 960,
    height: options.height ?? 600,
    backgroundColor: "#bfe6ff",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene],
  };

  return new Phaser.Game(config);
}

export { BootScene };
