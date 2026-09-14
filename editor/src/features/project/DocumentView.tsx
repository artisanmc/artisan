import { EmptyState } from "@/components/ui/empty-state";
import type { ElementId, ProjectId } from "@/domain/types";
import { Stage } from "@/features/canvas/Stage";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { CanvasWithInspector } from "@/features/project/CanvasWithInspector";
import { DocumentYamlView } from "@/features/project/DocumentYamlView";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { projectDestination } from "@/lib/projectNavigation";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useContext, useEffect, useState } from "react";
import { ResolvedProjectContext } from "./ResolvedProjectContext";
import { useTranslation } from "react-i18next";
import { documentLabel } from "./useProjectDocuments";

export function DocumentView({
  projectId,
  documentId,
}: { projectId: ProjectId; documentId: ElementId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  // The parent resolves the location before any document is selected.
  const resolvedId = useContext(ResolvedProjectContext) ?? projectId;
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === resolvedId));
  const pId = (project?.id ?? projectId) as ProjectId;
  const activeLang = useUiStore((s) => s.activeLang);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const eid = documentId as string;
  const [yamlMode, setYamlMode] = useState(false);
  const menu = project?.menus.find((m) => m.id === eid);
  const command = project?.commands.find((c) => c.id === eid);
  const dialog = project?.dialogs.find((d) => d.id === eid);
  // Le fichier du Document : son dossier dit sa nature, son nom son identité.
  const relPath = menu
    ? `menus/${eid}.yaml`
    : command
      ? `commands/${eid}.yaml`
      : dialog
        ? `dialogs/${eid}.yaml`
        : null;

  useEffect(() => {
    // Par défaut, sélectionne l'élément (menu/commande/dialog) lui-même. Mais si une
    // sélection cible déjà cet élément ou l'un de ses enfants — ex. la palette de
    // recherche qui sélectionne un item précis avant que cette vue ne monte — on la
    // préserve au lieu de l'écraser.
    const childIds = new Set<string>([documentId as string]);
    for (const layer of menu?.layers ?? [])
      for (const el of layer.elements ?? []) childIds.add(el.id);
    const current = useSelectionStore.getState().ids;
    const alreadyRelevant = current.size > 0 && [...current].every((id) => childIds.has(id));
    if (!alreadyRelevant) useSelectionStore.getState().set([documentId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const back = useCallback(
    () => navigate(projectDestination(params.networkId!, project ?? projectId, params.serverId)),
    [navigate, params.networkId, params.serverId, project, projectId],
  );

  // Echap revient à la planche. On ignore l'événement si le focus est dans un
  // champ de saisie (les éditeurs inline du FlowCanvas gèrent déjà Echap pour
  // annuler une édition), si un autre handler l'a déjà consommé, ou si une
  // modale/menu/liste est ouverte (qui doit fermer en premier).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
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
        <kbd className="ml-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
          Esc
        </kbd>
      </button>
      {/* Le libellé est du MiniMessage (titre de menu/dialogue) : on rend le
          style plutôt que d'imprimer les balises. */}
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

  if (!project || (!menu && !command && !dialog)) {
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
        <DocumentYamlView
          project={project}
          relPath={relPath}
          networkId={params.networkId}
          serverId={params.serverId}
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {menu ? (
        <CanvasWithInspector
          projectId={pId}
          canvas={<Stage projectId={pId} focus={documentId} />}
          mobileSize={editorPaneWidth}
          onMobileSizeChange={setEditorPaneWidth}
          minSecondary={280}
        />
      ) : (
        // Commands / dialogs have no stage: the pseudocode column stays centred,
        // with room at the top so the bubble never covers its first line.
        <div className="h-full overflow-auto">
          <div className="mx-auto w-full max-w-3xl pt-16">
            <FlowCanvas projectId={pId} />
          </div>
        </div>
      )}
      {header}
    </div>
  );
}
