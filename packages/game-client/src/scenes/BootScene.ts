import Phaser from "phaser";

/**
 * BootScene — Phase 0 placeholder.
 *
 * Draws the Volari sky backdrop + a floating-island silhouette so the
 * render pipeline (web shell → game-client → Phaser canvas) is proven
 * end-to-end. No game logic, no server connection yet.
 *
 * Phase 2 replaces this with the baked terrain + floating-island look and
 * a player that follows authoritative Colyseus state (see prototype
 * docs/volari.html).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    const { width, height } = this.scale;

    // Sky gradient backdrop (matches the prototype palette).
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x6fb7ff, 0x6fb7ff, 0xbfe6ff, 0xbfe6ff, 1);
    bg.fillRect(0, 0, width, height);

    // Floating island silhouette.
    const cx = width / 2;
    const cy = height / 2;
    const island = this.add.graphics();
    island.fillStyle(0x5bb05a, 1);
    island.fillEllipse(cx, cy, 220, 70);
    island.fillStyle(0x8a5a3c, 1);
    island.fillTriangle(cx - 90, cy + 18, cx + 90, cy + 18, cx, cy + 120);

    this.add
      .text(cx, cy - 110, "VOLARI", {
        fontFamily: "Fredoka, sans-serif",
        fontSize: "44px",
        color: "#2a2540",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy - 70, "Phase 0 — scaffold online", {
        fontFamily: "Nunito, sans-serif",
        fontSize: "16px",
        color: "#2a2540",
      })
      .setOrigin(0.5);

    // Gentle bob to confirm the update loop is alive.
    this.tweens.add({
      targets: island,
      y: 12,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });
  }
}
