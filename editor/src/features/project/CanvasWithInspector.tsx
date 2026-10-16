import { SplitPane } from "@/components/SplitPane";
import type { ProjectId } from "@/domain/types";
import { EditorPane } from "@/features/inspector/EditorPane";
import { FloatingEditorPane } from "@/features/inspector/FloatingEditorPane";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useUiStore } from "@/state/uiStore";
import { type ReactNode, useContext } from "react";
import { DockedInspectorContext } from "./inspectorLayout";
import { useProjectLibraryStore } from "./projectLibraryStore";
import { useInspector } from "./useInspector";

interface CanvasWithInspectorProps {
  projectId: ProjectId;
  /** The stage — board or focus view. */
  canvas: ReactNode;
  /** Panel height on mobile (each caller persists its own). */
  mobileSize: number;
  onMobileSizeChange: (size: number) => void;
  minSecondary?: number;
  minPrimary?: number;
}

/**
 * Stage + inspector. Mounted by the board AND by the focus view: the rule
 * "the panel only exists if there is something to inspect" is written only
 * here, otherwise the two surfaces would diverge (cf. `SoloMenuStage`).
 *
 * On desktop the panel FLOATS over the stage: hiding it uncovers canvas with
 * no reflow. On mobile it takes real height, so the stage gets it back.
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
  const libraryOpen = useProjectLibraryStore((s) => s.projectId === projectId);
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

  return (
    <SplitPane
      animatePresence
      orientation="vertical"
      primary={canvas}
      secondary={open && !libraryOpen ? <EditorPane projectId={projectId} /> : null}
      secondarySize={mobileSize}
      onSecondarySizeChange={onMobileSizeChange}
      minSecondary={minSecondary}
      minPrimary={minPrimary}
    />
  );
}
