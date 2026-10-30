import { EmptyState } from "@/components/ui/empty-state";
import { docKey, findDocumentByKey, resolveDocKey } from "@/domain/documents";
import type { ElementId, Menu, ProjectId } from "@/domain/types";
import { Stage } from "@/features/canvas/Stage";
import { SelectionInspector } from "@/features/inspector/SelectionInspector";
import { CanvasWithInspector } from "@/features/project/CanvasWithInspector";
import { DocumentYamlView, documentRelPath } from "@/features/project/DocumentYamlView";
import { collectionLabel, isCollectionKind } from "@/lib/documentCollections";
import { isTypingTarget } from "@/lib/keyboard";
import { collectionDestination, projectDestination } from "@/lib/projectNavigation";
import { useDocumentTrailStore } from "@/state/documentTrailStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResolvedProjectContext } from "./ResolvedProjectContext";
import { opensOnStage } from "./documentStage";
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
  const uiLang = useUiStore((s) => s.editorLang);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  // `?kind=` says which Document of that id; without it (an older link), the first.
  const { kind } = useSearch({ strict: false }) as { kind?: string };
  const key = kind
    ? docKey(kind, documentId)
    : project
      ? (resolveDocKey(project, documentId) ?? docKey("menu", documentId))
      : docKey("menu", documentId);
  const [yamlMode, setYamlMode] = useState(false);
  // Any kind, a module's included (its view is the kind's `component`, via SelectionInspector).
  const found = project ? findDocumentByKey(project, key) : undefined;
  const menu = found?.kind === "menu" ? (found.doc as Menu) : undefined;
  const relPath = project ? documentRelPath(project, key) : null;
  // A module kind whose node lists its parts opens on its node, like a menu: clicking a
  // part edits it in the panel beside.
  const onStage = project ? opensOnStage(project, key) : false;
  // A kind whose view is laid out in columns takes the whole width (SDK 1.15 `wide`).
  const wide = found ? documentKindContribution(found.kind)?.wide === true : false;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the default selection is applied once per opened document; re-running on `menu.layers` edits would reset the user's selection on every change
  useEffect(() => {
    // By default, select the element (menu/command/dialog) itself. But if a
    // selection already targets this element or one of its children — e.g. the
    // search palette selecting a specific item before this view mounts — keep it
    // instead of overwriting it.
    const childIds = new Set<string>([key]);
    for (const layer of menu?.layers ?? [])
      for (const el of layer.elements ?? []) childIds.add(el.id);
    const current = useSelectionStore.getState().ids;
    const alreadyRelevant = current.size > 0 && [...current].every((id) => childIds.has(id));
    if (!alreadyRelevant) useSelectionStore.getState().set([key]);
  }, [key]);

  // A collection's Document goes back to its collection's page, the board does not show it.
  const backKind = found && isCollectionKind(found.kind) ? found.kind : undefined;
  const toProject = useCallback(
    () => navigate(projectDestination(project ?? projectId, params.serverId)),
    [navigate, params.serverId, project, projectId],
  );
  const toCollection = useCallback(() => {
    if (backKind && params.serverId)
      navigate(collectionDestination(project ?? projectId, params.serverId, backKind));
  }, [navigate, params.serverId, project, projectId, backKind]);
  const back = backKind && params.serverId ? toCollection : toProject;

  // The topbar's breadcrumb carries the Document's levels and its YAML switch.
  const setTrail = useDocumentTrailStore((s) => s.setTrail);
  const label = project ? documentLabel(project, key, activeLang) : documentId;
  const collection =
    backKind && params.serverId
      ? collectionLabel(documentKindContribution(backKind), backKind, uiLang)
      : undefined;
  const hasDocument = found !== undefined;
  useEffect(() => {
    setTrail({
      toProject,
      collection: collection ? { label: collection, open: toCollection } : undefined,
      label,
      yaml:
        relPath && hasDocument
          ? { on: yamlMode, toggle: () => setYamlMode((v) => !v), path: relPath }
          : undefined,
    });
  }, [setTrail, toProject, toCollection, collection, label, relPath, hasDocument, yamlMode]);
  useEffect(() => () => setTrail(null), [setTrail]);

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

  if (!project || !found) {
    return (
      <div className="absolute inset-0">
        <div className="flex h-full items-center justify-center">
          <EmptyState title={t("documentView.notFound")} />
        </div>
      </div>
    );
  }

  if (yamlMode && relPath) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <DocumentYamlView project={project} relPath={relPath} serverId={params.serverId} />
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {onStage ? (
        <CanvasWithInspector
          projectId={pId}
          canvas={<Stage projectId={pId} focus={key} />}
          mobileSize={editorPaneWidth}
          onMobileSizeChange={setEditorPaneWidth}
          minSecondary={280}
        />
      ) : (
        // Other kinds have no stage: their view (a command's pseudocode) stays centred, or
        // spans the width when its kind asks for it.
        <div className="h-full overflow-auto">
          <div
            className={wide ? "w-full pt-3" : "mx-auto w-full max-w-5xl pt-3"}
            data-testid="document-body"
          >
            <SelectionInspector projectId={pId} />
          </div>
        </div>
      )}
    </div>
  );
}
