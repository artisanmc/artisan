import { createFileRoute, useParams } from "@tanstack/react-router";
import type { ElementId, PackId } from "@/domain/types";
import { ElementView } from "@/features/workspace/ElementView";

export const Route = createFileRoute(
  "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
)({ component: ElementRoute });

function ElementRoute() {
  const { workspaceId, elementId } = useParams({
    from: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
  });
  return <ElementView packId={workspaceId as PackId} elementId={elementId as ElementId} />;
}
