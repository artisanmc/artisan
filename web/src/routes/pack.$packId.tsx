import { VerticalSplit } from "@/components/VerticalSplit";
import type { PackId } from "@/domain/types";
import { PackMiniSidebar } from "@/features/account/PackMiniSidebar";
import { RightSidebar } from "@/features/canvas/RightSidebar";
import { Stage } from "@/features/canvas/Stage";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { useUiStore } from "@/state/uiStore";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  const pId = packId as PackId;
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);

  useEffect(() => {
    const current = useUiStore.getState().lastActivePackId;
    if (current !== pId) useUiStore.getState().setLastActivePackId(pId);
  }, [pId]);

  return (
    <div className="flex h-screen overflow-hidden">
      <PackMiniSidebar activePackId={pId} />
      <main className="min-w-0 flex-1 overflow-hidden">
        <VerticalSplit
          top={<Stage packId={pId} />}
          bottom={<FlowCanvas packId={pId} />}
          bottomHeight={flowCanvasHeight}
          onBottomHeightChange={setFlowCanvasHeight}
        />
      </main>
      <RightSidebar packId={pId} />
    </div>
  );
}
