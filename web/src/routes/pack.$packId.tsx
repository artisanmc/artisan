import type { PackId } from "@/domain/types";
import { Stage } from "@/features/canvas/Stage";
import { Link, createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm">
        <Link to="/" className="text-zinc-400 hover:text-zinc-100">
          ← Packs
        </Link>
        <span className="text-zinc-500">/</span>
        <span className="font-mono">{packId}</span>
      </header>
      <main className="flex-1">
        <Stage packId={packId as PackId} />
      </main>
    </div>
  );
}
