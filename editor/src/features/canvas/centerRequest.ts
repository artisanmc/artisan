import type { Project } from "@/domain/types";
import type { CenterRequest } from "@/state/uiStore";
import { centerViewport } from "./focusViewport";
import { nodeBox } from "./menuLayout";
import type { ViewportState } from "./usePanZoom";

/**
 * The framing a centre request (`goToDocument`) gives THIS board, or `null`
 * while it cannot answer yet (other project, board without a size, Document
 * not placed yet) — the request then waits.
 */
export function viewportForCenterRequest(
  request: CenterRequest | null,
  projectId: string,
  project: Project | undefined,
  layout: Record<string, { x: number; y: number }>,
  size: { w: number; h: number },
): ViewportState | null {
  if (!request || !project || request.projectId !== projectId) return null;
  if (size.w <= 0 || size.h <= 0) return null;
  const box = nodeBox(project, request.docId, layout);
  return box ? centerViewport(size, box) : null;
}
