import dynamic from "next/dynamic";

// SSR disabled — the game client touches `window`.
const GameMount = dynamic(() => import("@/components/GameMount"), { ssr: false });

export default function HomePage() {
  return (
    <main>
      <h1 className="brand">VOLARI</h1>
      <p className="tag">Sky-farm GameFi — claim your island, farm, trade $VOLA</p>
      <GameMount />
    </main>
  );
}
