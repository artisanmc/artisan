import type { PackId } from "@/domain/types";
import { PackMiniSidebar } from "@/features/account/PackMiniSidebar";
import { RightSidebar } from "@/features/canvas/RightSidebar";
import { Stage } from "@/features/canvas/Stage";
import { useUiStore } from "@/state/uiStore";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  const pId = packId as PackId;

  useEffect(() => {
    const current = useUiStore.getState().lastActivePackId;
    if (current !== pId) useUiStore.getState().setLastActivePackId(pId);
  }, [pId]);

  return (
    <div className="flex h-screen overflow-hidden">
      <PackMiniSidebar activePackId={pId} />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Stage packId={pId} />
      </main>
      <RightSidebar packId={pId} />
    </div>
  );
}
