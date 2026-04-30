import type { MenuId, PackId } from "@/domain/types";
import { Canvas } from "@/features/pack-canvas/Canvas";
import { MovePackSidebar } from "@/features/pack-canvas/MovePackSidebar";
import { useAccountStore } from "@/state/accountStore";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  const [error, setError] = useState<string | null>(null);
  const moveMenuToPack = useAccountStore((s) => s.moveMenuToPack);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const overData = event.over?.data.current as { packId?: PackId } | undefined;
    const activeData = event.active.data.current as { kind?: "menu"; menuId?: MenuId } | undefined;
    if (!overData?.packId || !activeData?.menuId) return;
    try {
      moveMenuToPack({
        menuId: activeData.menuId,
        fromPackId: packId as PackId,
        toPackId: overData.packId,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "move failed");
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-screen flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm">
          <Link to="/" className="text-zinc-400 hover:text-zinc-100">
            ← Packs
          </Link>
          <span className="text-zinc-500">/</span>
          <span className="font-mono">{packId}</span>
          {error && <span className="ml-auto text-red-400 text-xs">{error}</span>}
        </header>
        <div className="flex flex-1">
          <main className="flex-1">
            <Canvas packId={packId as PackId} />
          </main>
          <MovePackSidebar currentPackId={packId as PackId} />
        </div>
      </div>
    </DndContext>
  );
}
