import dynamic from "next/dynamic";

// SSR disabled — the game client touches `window`.
const GameMount = dynamic(() => import("@/components/GameMount"), { ssr: false });

export default function HomePage() {
  return <GameMount />;
}
