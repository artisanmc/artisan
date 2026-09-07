import { SplitPane } from "@/components/SplitPane";
import type { ProjectId } from "@/domain/types";
import { EditorPane } from "@/features/canvas/EditorPane";
import { FloatingEditorPane } from "@/features/canvas/FloatingEditorPane";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useUiStore } from "@/state/uiStore";
import { type ReactNode, useContext } from "react";
import { DockedInspectorContext } from "./inspectorLayout";
import { useInspector } from "./useInspector";

interface CanvasWithInspectorProps {
  projectId: ProjectId;
  /** La scène — planche ou vue focus. */
  canvas: ReactNode;
  /** Hauteur du panneau en mobile (chaque appelant persiste la sienne). */
  mobileSize: number;
  onMobileSizeChange: (size: number) => void;
  minSecondary?: number;
  minPrimary?: number;
}

/**
 * Scène + inspecteur. Monté par la planche ET par la vue focus : la règle
 * « le panneau n'existe que s'il y a quelque chose à inspecter » ne s'écrit
 * qu'ici, sinon les deux surfaces divergeraient (cf. `SoloMenuStage`).
 *
 * En desktop le panneau FLOTTE au-dessus de la scène : le masquer découvre du
 * canvas sans aucun reflow. En mobile il occupe une vraie hauteur, donc la
 * scène la récupère.
 */
export function CanvasWithInspector({
  projectId,
  canvas,
  mobileSize,
  onMobileSizeChange,
  minSecondary = 120,
  minPrimary = 200,
}: CanvasWithInspectorProps) {
  const { open } = useInspector(projectId);
  const isDesktop = useIsDesktop();
  const docked = useContext(DockedInspectorContext);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);

  if (isDesktop) {
    return (
      <>
        <div className="absolute inset-0">{canvas}</div>
        {open && !docked && (
          <FloatingEditorPane
            projectId={projectId}
            width={editorPaneWidth}
            onWidthChange={setEditorPaneWidth}
          />
        )}
      </>
    );
  }

  if (!open) return <div className="h-full w-full">{canvas}</div>;

  return (
    <SplitPane
      orientation="vertical"
      primary={canvas}
      secondary={<EditorPane projectId={projectId} />}
      secondarySize={mobileSize}
      onSecondarySizeChange={onMobileSizeChange}
      minSecondary={minSecondary}
      minPrimary={minPrimary}
    />
  );
}
