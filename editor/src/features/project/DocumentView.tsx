import { EmptyState } from "@/components/ui/empty-state";
import { findDocument, menusOf } from "@/domain/documents";
import type { ElementId, ProjectId } from "@/domain/types";
import { Stage } from "@/features/canvas/Stage";
import { SelectionInspector } from "@/features/inspector/SelectionInspector";
import { CanvasWithInspector } from "@/features/project/CanvasWithInspector";
import { DocumentYamlView, documentRelPath } from "@/features/project/DocumentYamlView";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { isTypingTarget } from "@/lib/keyboard";
import { projectDestination } from "@/lib/projectNavigation";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResolvedProjectContext } from "./ResolvedProjectContext";
import { documentLabel } from "./useProjectDocuments";

export function DocumentView({
  projectId,
  documentId,
}: { projectId: ProjectId; documentId: ElementId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { serverId?: string };
  // The parent resolves the location before any document is selected.
  const resolvedId = useContext(ResolvedProjectContext) ?? projectId;
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === resolvedId));
  const pId = (project?.id ?? projectId) as ProjectId;
  const activeLang = useUiStore((s) => s.activeLang);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const eid = documentId as string;
  const [yamlMode, setYamlMode] = useState(false);
  const menu = menusOf(project).find((m) => m.id === eid);
  // Any kind, a module's included (its view is the kind's `component`, via SelectionInspector).
  const found = project ? findDocument(project, eid) : undefined;
  const relPath = project ? documentRelPath(project, eid) : null;
  // A module kind whose node lists its parts opens on its node, like a menu: clicking a
  // part edits it in the panel beside.
  const onStage =
    menu != null || (found != null && documentKindContribution(found.kind)?.board?.items != null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the default selection is applied once per opened document; re-running on `menu.layers` edits would reset the user's selection on every change
  useEffect(() => {
    // By default, select the element (menu/command/dialog) itself. But if a
    // selection already targets this element or one of its children — e.g. the
    // search palette selecting a specific item before this view mounts — keep it
    // instead of overwriting it.
    const childIds = new Set<string>([documentId as string]);
    for (const layer of menu?.layers ?? [])
      for (const el of layer.elements ?? []) childIds.add(el.id);
    const current = useSelectionStore.getState().ids;
    const alreadyRelevant = current.size > 0 && [...current].every((id) => childIds.has(id));
    if (!alreadyRelevant) useSelectionStore.getState().set([documentId]);
  }, [documentId]);

  const back = useCallback(
    () => navigate(projectDestination(project ?? projectId, params.serverId)),
    [navigate, params.serverId, project, projectId],
  );

  // Escape goes back to the board. The event is ignored if focus is in an input
  // (SelectionInspector's inline editors already handle Escape to cancel an edit), if
  // another handler already consumed it, or if a modal/menu/list is open (it
  // must close first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  // Floating bubble instead of a full-width bar: same place, but the stage
  // spans the whole region underneath — same language as the canvas toolbar
  // and the floating editor pane.
  const header = (
    <div
      data-testid="document-view-bubble"
      className="absolute top-3 left-3 z-20 flex max-w-[min(28rem,calc(100%-1.5rem))] items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface-raised)]/95 py-1 pr-3 pl-1 shadow-[var(--shadow-lg)] backdrop-blur"
    >
      <button
        type="button"
        onClick={back}
        className="btn btn-ghost btn-sm inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
      >
        <ArrowLeft className="size-4" /> {t("documentView.back")}
        <kbd className="ml-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-faint)]">
          Esc
        </kbd>
      </button>
      {/* The label is MiniMessage (menu/dialog title): render the style
          instead of printing the tags. */}
      <MiniMessageInline
        source={project ? documentLabel(project, documentId as string, activeLang) : documentId}
        className="truncate text-[13px] font-medium text-[var(--text)]"
      />
      {relPath ? (
        <button
          type="button"
          onClick={() => setYamlMode((v) => !v)}
          className="btn btn-ghost btn-sm shrink-0"
          title={relPath}
        >
          {yamlMode ? t("yamlView.visual") : t("yamlView.tab")}
        </button>
      ) : null}
    </div>
  );

  if (!project || !found) {
    return (
      <div className="absolute inset-0">
        {header}
        <div className="flex h-full items-center justify-center">
          <EmptyState title={t("documentView.notFound")} />
        </div>
      </div>
    );
  }

  if (yamlMode && relPath) {
    return (
      <div className="absolute inset-0 flex flex-col pt-14">
        {header}
        <DocumentYamlView project={project} relPath={relPath} serverId={params.serverId} />
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {onStage ? (
        <CanvasWithInspector
          projectId={pId}
          canvas={<Stage projectId={pId} focus={documentId} />}
          mobileSize={editorPaneWidth}
          onMobileSizeChange={setEditorPaneWidth}
          minSecondary={280}
        />
      ) : (
        // Other kinds have no stage: their view (a command's pseudocode) stays centred,
        // with room at the top so the bubble never covers its first line.
        <div className="h-full overflow-auto">
          <div className="mx-auto w-full max-w-5xl pt-16">
            <SelectionInspector projectId={pId} />
          </div>
        </div>
      )}
      {header}
    </div>
  );
}
