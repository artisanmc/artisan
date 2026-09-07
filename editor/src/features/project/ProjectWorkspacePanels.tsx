import { SplitPane } from "@/components/SplitPane";
import type { ProjectId } from "@/domain/types";
import { EditorPane } from "@/features/canvas/EditorPane";
import { useUiStore } from "@/state/uiStore";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ProjectElementsSidebar } from "./ProjectElementsSidebar";
import { DockedInspectorContext } from "./inspectorLayout";
import { useInspector } from "./useInspector";

export function ProjectWorkspacePanels({
  projectId,
  active,
  children,
}: {
  projectId: ProjectId;
  active: boolean;
  children: ReactNode;
}) {
  const treeOpen = useUiStore((s) => s.projectPanelOpen);
  const width = useUiStore((s) => s.editorPaneWidth);
  const setWidth = useUiStore((s) => s.setEditorPaneWidth);
  const { open } = useInspector(projectId);
  const propertiesOpen = active && open;
  const [availableWidth, setAvailableWidth] = useState(1200);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sidebar = propertiesOpen ? (
    <aside data-testid="project-side-panel" className="h-full min-h-0 bg-[var(--surface)]">
      <EditorPane projectId={projectId} />
    </aside>
  ) : null;
  return (
    <DockedInspectorContext.Provider value={true}>
      <div ref={frame} className="relative flex h-full min-h-0 w-full">
        <div className="h-full min-h-0 min-w-0 flex-1">
          <SplitPane
            orientation="horizontal"
            primary={children}
            secondary={sidebar}
            secondarySize={Math.min(
              width,
              Math.max(300, availableWidth - (treeOpen ? 240 : 0) - 300),
            )}
            onSecondarySizeChange={setWidth}
            minPrimary={300}
            minSecondary={300}
          />
        </div>
        <ProjectElementsSidebar key={projectId} projectId={projectId} />
      </div>
    </DockedInspectorContext.Provider>
  );
}
