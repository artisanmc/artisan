import { EditorPane } from "@/features/canvas/EditorPane";
import { Library } from "@/features/canvas/Library";
import { Stage } from "@/features/canvas/Stage";
import type { ProjectId } from "@/domain/types";
import { reapplyCamera } from "./drive";
import Konva from "konva";
import { useLayoutEffect } from "react";
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame } from "remotion";

export const LIBRARY_W = 340;
export const INSPECTOR_W = 460;

/** L'espace de travail de l'éditeur : bibliothèque, canvas, inspecteur. */
/**
 * Konva redessine au prochain `requestAnimationFrame` : on attend qu'il l'ait
 * fait (et que les effets du Stage aient tourné) avant la capture de l'image.
 */
function useSettledCanvas() {
  const frame = useCurrentFrame();
  // biome-ignore lint/correctness/useExhaustiveDependencies: une attente par image
  useLayoutEffect(() => {
    const handle = delayRender(`Canvas image ${frame}`);
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        reapplyCamera();
        for (const stage of Konva.stages) stage.draw();
        continueRender(handle);
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      continueRender(handle);
    };
  }, [frame]);
}

/**
 * `inspector` : ancré à droite (`true`), absent, ou en surimpression qui glisse
 * depuis la droite (0 = caché, 1 = visible) sans redimensionner le canvas.
 */
export function Workspace({
  projectId,
  library = true,
  inspector = true,
}: { projectId: ProjectId; library?: boolean; inspector?: boolean | number }) {
  useSettledCanvas();
  return (
    <AbsoluteFill style={{ background: "var(--surface)", flexDirection: "row" }}>
      {library && (
        <div
          style={{
            width: LIBRARY_W,
            flexShrink: 0,
            borderRight: "1px solid var(--border-soft)",
            background: "var(--surface-raised)",
            overflow: "hidden",
            padding: "12px 8px 0",
          }}
        >
          <Library />
        </div>
      )}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <Stage projectId={projectId} />
      </div>
      {typeof inspector === "number" && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: INSPECTOR_W,
            borderLeft: "1px solid var(--border-soft)",
            background: "var(--surface-raised)",
            overflow: "hidden",
            transform: `translateX(${(1 - inspector) * 105}%)`,
            boxShadow: "-24px 0 60px rgba(0,0,0,.35)",
          }}
        >
          <EditorPane projectId={projectId} />
        </div>
      )}
      {inspector === true && (
        <div
          style={{
            width: INSPECTOR_W,
            flexShrink: 0,
            borderLeft: "1px solid var(--border-soft)",
            background: "var(--surface-raised)",
            overflow: "hidden",
          }}
        >
          <EditorPane projectId={projectId} />
        </div>
      )}
    </AbsoluteFill>
  );
}
