"use client";

import { useEffect, useRef } from "react";

/**
 * Mounts the Phaser game client on the browser only. Phaser needs `window`,
 * so we import it inside an effect (never during SSR) and tear the instance
 * down on unmount. Phase 0 renders the BootScene placeholder.
 */
export default function GameMount() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: { destroy: (removeCanvas: boolean) => void } | undefined;
    let cancelled = false;

    void import("@skyhaven/game-client").then(({ createGame }) => {
      if (cancelled || !containerRef.current) return;
      game = createGame({ parent: containerRef.current });
    });

    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, []);

  return <div ref={containerRef} className="stage" />;
}
