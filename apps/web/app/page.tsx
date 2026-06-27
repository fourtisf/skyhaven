import dynamic from "next/dynamic";

// SSR disabled — the game client touches `window`.
const GameMount = dynamic(() => import("@/components/GameMount"), { ssr: false });

export default function HomePage() {
  return (
    <main>
      <h1 className="brand">SKYHAVEN</h1>
      <p className="tag">Sky-farm GameFi — Phase 0 scaffold</p>
      <GameMount />
    </main>
  );
}
