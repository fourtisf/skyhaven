"use client";

import { useEffect, useRef, useState } from "react";
import { COLS, ROWS, WORLD_W, WORLD_H, isLand, isPond } from "@volari/world";

// Minimal shape of the Phaser game we use (avoids bundling Phaser types here).
interface GameLike {
  events: {
    on: (e: string, cb: (...a: unknown[]) => void) => void;
    emit: (e: string, ...a: unknown[]) => void;
  };
  registry: { set: (k: string, v: unknown) => void };
  destroy: (removeCanvas: boolean) => void;
}

interface Hud {
  online: boolean;
  coins?: number;
  level?: number;
  xp?: number;
  xpNext?: number;
  seeds?: number;
  feed?: number;
  berries?: number;
  eggs?: number;
  wool?: number;
  goldwool?: number;
  vola?: number;
  quest?: { label: string; hint: string; step: number; total: number };
  daily?: { have: number; need: number };
  action?: string;
  playerX?: number;
  playerY?: number;
}

export default function GameMount() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameLike | null>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({ online: false });

  // Boot the game + subscribe to HUD updates.
  useEffect(() => {
    let game: GameLike | undefined;
    let cancelled = false;
    void import("@volari/game-client").then(({ createGame }) => {
      if (cancelled || !containerRef.current) return;
      game = createGame({
        parent: containerRef.current,
        serverUrl: process.env.NEXT_PUBLIC_REALTIME_URL,
      }) as unknown as GameLike;
      gameRef.current = game;
      game.events.on("hud", (h: unknown) => setHud(h as Hud));
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  // Bake the minimap island once.
  useEffect(() => {
    const cv = miniRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const sx = cv.width / COLS;
    const sy = cv.height / ROWS;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!isLand(tx, ty)) continue;
        ctx.fillStyle = isPond(tx, ty) ? "#5fb8d8" : "#74c463";
        ctx.fillRect(tx * sx, ty * sy, sx + 0.6, sy + 0.6);
      }
    }
  }, []);

  // Player dot on the minimap.
  useEffect(() => {
    const cv = miniRef.current;
    if (!cv || hud.playerX == null) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    // redraw is cheap; the baked island stays, just stamp the dot via overlay
    const x = (hud.playerX / WORLD_W) * cv.width;
    const y = ((hud.playerY ?? 0) / WORLD_H) * cv.height;
    ctx.save();
    ctx.fillStyle = "#ffce4f";
    ctx.strokeStyle = "#2a2540";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 6.28);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [hud.playerX, hud.playerY]);

  const emit = (e: string) => gameRef.current?.events.emit(e);

  // Joystick drag → movement vector in the game registry.
  const joyBaseRef = useRef<HTMLDivElement>(null);
  const [nub, setNub] = useState({ x: 0, y: 0 });
  const setJoy = (cx: number, cy: number) => {
    const base = joyBaseRef.current;
    if (!base) return;
    const r = base.getBoundingClientRect();
    const R = r.width / 2;
    let dx = cx - (r.left + R);
    let dy = cy - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    setNub({ x: dx, y: dy });
    gameRef.current?.registry.set("joy", { x: dx / R, y: dy / R });
  };
  const resetJoy = () => {
    setNub({ x: 0, y: 0 });
    gameRef.current?.registry.set("joy", { x: 0, y: 0 });
  };

  const fmt = (n?: number) => (n ?? 0).toString();

  return (
    <div className="stage">
      <div ref={containerRef} className="canvas-host" />

      {hud.online && (
        <>
          {/* top-left resource chips */}
          <div className="hud-chips">
            <div className="chip">🪙 <b>{fmt(hud.coins)}</b></div>
            <div className="chip">💎 <b>{fmt(hud.vola)}</b></div>
            <div className="chip">⭐ Lv {fmt(hud.level)}</div>
            <div className="chip">🌱 {fmt(hud.seeds)}</div>
            <div className="chip">🌾 {fmt(hud.feed)}</div>
            <div className="chip">🫐 {fmt(hud.berries)}</div>
            <div className="chip">🥚 {fmt(hud.eggs)}</div>
            <div className="chip">🧶 {fmt(hud.wool)}</div>
            <div className="chip">✨ {fmt(hud.goldwool)}</div>
          </div>

          {/* XP bar */}
          <div className="xpwrap">
            <div
              className="xpfill"
              style={{ width: `${Math.min(100, ((hud.xp ?? 0) / (hud.xpNext || 1)) * 100)}%` }}
            />
          </div>

          {/* minimap */}
          <canvas ref={miniRef} width={124} height={92} className="minimap" />

          {/* quest card */}
          {hud.quest && (
            <div className="quest-card">
              <div className="qh">
                Quest · {hud.quest.step + 1}/{hud.quest.total}
              </div>
              <div className="qt">{hud.quest.label}</div>
              <div className="qp">
                {hud.quest.hint}
                {hud.daily ? ` · Daily ${hud.daily.have}/${hud.daily.need}` : ""}
              </div>
            </div>
          )}

          {/* shop / market / build buttons */}
          <div className="topbtns">
            <button className="uibtn" onPointerDown={() => emit("ui-barn")}>🏚️ Barn</button>
            <button className="uibtn" onPointerDown={() => emit("ui-market")}>🛒 Market</button>
            <button className="uibtn" onPointerDown={() => emit("ui-build")}>🔨 Build</button>
          </div>

          {/* joystick */}
          <div
            ref={joyBaseRef}
            className="joystick"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setJoy(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (e.buttons) setJoy(e.clientX, e.clientY);
            }}
            onPointerUp={resetJoy}
            onPointerCancel={resetJoy}
          >
            <div className="joynub" style={{ transform: `translate(${nub.x}px, ${nub.y}px)` }} />
          </div>

          {/* action button */}
          <button className="actionbtn" onPointerDown={() => emit("ui-action")}>
            {hud.action ? <span className="actlbl">{hud.action}</span> : "✦"}
          </button>
        </>
      )}

      {!hud.online && <div className="offline-note">Connecting to the island…</div>}
    </div>
  );
}
