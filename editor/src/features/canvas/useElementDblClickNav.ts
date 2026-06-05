import type { ElementId, PackId } from "@/domain/types";
import type Konva from "konva";
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Returns an `onDblClick` / `onDblTap` handler that navigates to the
 * focus-mode route for the given element.
 *
 * Takes all four URL params explicitly to avoid relying on loose
 * `useParams({ strict: false })` which returns an empty object when called
 * from canvas components mounted under the workspace route.
 */
export function useElementDblClickNav(
  packId: PackId,
  elementId: ElementId,
  networkId: string,
  serverId: string,
) {
  const navigate = useNavigate();

  return useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      navigate({
        to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
        params: { networkId, serverId, workspaceId: packId, elementId },
      });
    },
    [navigate, packId, elementId, networkId, serverId],
  );
}
