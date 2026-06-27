"use client";

import { useEffect, useRef, useState } from "react";
import { COLS, ROWS, WORLD_W, WORLD_H, isLand, isPond } from "@volari/world";

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
  playerCount?: number;
  leaders?: { name: string; level: number; coins: number; me: boolean }[];
}

export default function GameMount() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameLike | null>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const joyBaseRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState<Hud>({ online: false });
  const [nub, setNub] = useState({ x: 0, y: 0 });
  const [levelUp, setLevelUp] = useState<number | null>(null);

  // Boot the game only after "Start farming".
  useEffect(() => {
    if (!started) return;
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
      game.events.on("levelup", (lvl: unknown) => {
        setLevelUp(lvl as number);
        window.setTimeout(() => setLevelUp(null), 1800);
      });
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
      gameRef.current = null;
    };
  }, [started]);

  // Bake the minimap island when it appears.
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
  }, [hud.online]);

  // Player dot on the minimap.
  useEffect(() => {
    const cv = miniRef.current;
    if (!cv || hud.playerX == null) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
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
  const fmt = (n?: number) => (n ?? 0).toString();

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

  // ── Intro screen ──
  if (!started) {
    return (
      <div className="game-root">
        <div className="intro">
          <div className="intro-clouds">
            <span className="cloud c1" />
            <span className="cloud c2" />
            <span className="cloud c3" />
            <span className="cloud c4" />
            <span className="cloud c5" />
          </div>
          <div className="intro-pill">Sky-farm GameFi · $VOLA on devnet</div>
          <h1 className="intro-title">Volari</h1>
          <p className="intro-tag">
            Claim the sky, raise cloud livestock, and tend your fields on floating islands.
          </p>
          <button className="start-btn" onClick={() => setStarted(true)}>
            Start farming ✦
          </button>
          <p className="intro-hint">
            Drag the stick (or WASD) to move · ✦ / E to interact · 🔨 build mode
          </p>
        </div>
      </div>
    );
  }

  // ── Game + overlay ──
  return (
    <div className="game-root">
      <div ref={containerRef} className="canvas-host" />

      {hud.online && (
        <>
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

          <div className="xpwrap">
            <div
              className="xpfill"
              style={{ width: `${Math.min(100, ((hud.xp ?? 0) / (hud.xpNext || 1)) * 100)}%` }}
            />
          </div>

          <canvas ref={miniRef} width={124} height={92} className="minimap" />

          {hud.leaders && hud.leaders.length > 0 && (
            <div className="leaderboard">
              <div className="lb-head">🏆 Top farmers · {hud.playerCount} online</div>
              {hud.leaders.map((l, i) => (
                <div key={i} className={`lb-row${l.me ? " me" : ""}`}>
                  <span className="lb-rank">{i + 1}</span>
                  <span className="lb-name">{l.name}</span>
                  <span className="lb-stat">Lv{l.level} · {l.coins}🪙</span>
                </div>
              ))}
            </div>
          )}

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

          <div className="topbtns">
            <button className="uibtn" onPointerDown={() => emit("ui-barn")}>🏚️ Barn</button>
            <button className="uibtn" onPointerDown={() => emit("ui-market")}>🛒 Market</button>
            <button className="uibtn" onPointerDown={() => emit("ui-build")}>🔨 Build</button>
          </div>

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

          <button className="actionbtn" onPointerDown={() => emit("ui-action")}>
            {hud.action ? <span className="actlbl">{hud.action}</span> : "✦"}
          </button>
        </>
      )}

      {levelUp != null && (
        <div className="levelup" key={levelUp}>
          ⭐ LEVEL UP!
          <span>Lv {levelUp}</span>
        </div>
      )}

      {!hud.online && <div className="offline-note">Connecting to the island…</div>}
    </div>
  );
}
