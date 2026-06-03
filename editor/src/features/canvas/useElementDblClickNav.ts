import type { ElementId, PackId } from "@/domain/types";
import type Konva from "konva";
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Returns an `onDblClick` / `onDblTap` handler that navigates to the
 * focus-mode route for the given element. Pass it to the root Konva
 * `<Group onDblClick={onDblClick} onDblTap={onDblClick}>`.
 *
 * Takes `packId` explicitly instead of reading it from `useParams({ strict:
 * false })` — that loose introspection returns an empty object when called
 * from canvas components mounted under the workspace route, so navigate was
 * silently early-returning when `workspaceId` came back undefined.
 */
export function useElementDblClickNav(packId: PackId, elementId: ElementId) {
  const navigate = useNavigate();

  return useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      navigate({
        to: "/workspace/$workspaceId/element/$elementId",
        params: { workspaceId: packId, elementId },
      });
    },
    [navigate, packId, elementId],
  );
}
