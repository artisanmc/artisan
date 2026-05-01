import type { PackId } from "@/domain/types";
import { PackMiniSidebar } from "@/features/account/PackMiniSidebar";
import { MaterialPalette } from "@/features/canvas/MaterialPalette";
import { PropertiesPane } from "@/features/canvas/PropertiesPane";
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
      {/* min-w-0 lets this flex-1 column actually shrink below its content's
          min-content size; without it, the Konva canvas's intrinsic width
          pushes the column past its allocation and shoves the right pane
          off-screen. Same fix on <main> for the canvas wrapper. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-w-0 flex-1 overflow-hidden">
          <Stage packId={pId} />
        </main>
        <MaterialPalette />
      </div>
      <PropertiesPane packId={pId} />
    </div>
  );
}
