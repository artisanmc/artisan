import type { ElementId } from "@/domain/types";
import type Konva from "konva";
import { useCallback } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";

/**
 * Returns an `onDblClick` / `onDblTap` handler that navigates to the
 * focus-mode route for the given element. Pass it to the root Konva
 * `<Group onDblClick={onDblClick} onDblTap={onDblClick}>`.
 *
 * Uses `strict: false` because canvas group components live under the
 * workspace route, not under the focus-mode route. The workspaceId is
 * therefore present in the URL but not guaranteed by strict typing.
 */
export function useElementDblClickNav(elementId: ElementId) {
  const navigate = useNavigate();
  const { workspaceId } = useParams({ strict: false }) as { workspaceId?: string };

  return useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      if (!workspaceId) return;
      navigate({
        to: "/workspace/$workspaceId/element/$elementId",
        params: { workspaceId, elementId },
      });
    },
    [navigate, workspaceId, elementId],
  );
}
