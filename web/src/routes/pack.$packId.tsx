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
  const setLastActivePackId = useUiStore((s) => s.setLastActivePackId);

  useEffect(() => {
    setLastActivePackId(pId);
  }, [pId, setLastActivePackId]);

  return (
    <div className="flex h-screen overflow-hidden">
      <PackMiniSidebar activePackId={pId} />
      <div className="flex flex-1 flex-col">
        <main className="flex-1">
          <Stage packId={pId} />
        </main>
        <MaterialPalette />
      </div>
      <PropertiesPane packId={pId} />
    </div>
  );
}
