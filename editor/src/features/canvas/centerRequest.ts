import type { Project } from "@/domain/types";
import type { CenterRequest } from "@/state/uiStore";
import { centerViewport } from "./focusViewport";
import { nodeBox } from "./menuLayout";
import type { ViewportState } from "./usePanZoom";

/**
 * Le cadrage qu'une demande de centrage (`goToDocument`) donne à CETTE planche,
 * ou `null` tant qu'elle ne peut pas encore y répondre (autre project, planche
 * sans taille, Document pas encore placé) — la demande attend alors.
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
