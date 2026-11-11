import type { Project } from "@/domain/types";
import { useEffect, useRef } from "react";
import { centerViewport } from "./focusViewport";
import { nodeBox } from "./menuLayout";
import type { ViewportState } from "./usePanZoom";

/**
 * Narrowing the board to a folder frames what remains, once per folder chosen:
 * after that the user pans freely. Clearing the filter leaves the view as is.
 */
export function useFolderFraming({
  folder,
  project,
  layout,
  size,
  setViewport,
}: {
  folder: string | undefined;
  project: Project | undefined;
  layout: Record<string, { x: number; y: number }>;
  size: { w: number; h: number };
  setViewport: (viewport: ViewportState) => void;
}) {
  const framed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!folder) {
      framed.current = undefined;
      return;
    }
    if (framed.current === folder || !project || size.w === 0) return;
    const boxes = Object.keys(layout).flatMap((id) => nodeBox(project, id, layout) ?? []);
    if (boxes.length === 0) return;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const width = Math.max(...boxes.map((b) => b.x + b.width)) - x;
    const height = Math.max(...boxes.map((b) => b.y + b.height)) - y;
    framed.current = folder;
    setViewport(centerViewport(size, { x, y, width, height }));
  }, [folder, project, layout, size, setViewport]);
}
