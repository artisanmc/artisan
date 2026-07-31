import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ElementId, MenuId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { EmptyState } from "@/components/ui/empty-state";
import { SplitPane } from "@/components/SplitPane";
import { EditorPane } from "@/features/canvas/EditorPane";
import { FloatingEditorPane } from "@/features/canvas/FloatingEditorPane";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { SoloMenuStage } from "./SoloMenuStage";
import { documentLabel } from "./useProjectDocuments";

export function DocumentView({ projectId, documentId }: { projectId: ProjectId; documentId: ElementId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  // L'URL peut désigner le project par son slug : l'id reste l'identité, mais
  // la vue doit reconnaître les deux formes (ADR yaml-assisted-editing n'a rien
  // à voir ici — c'est le passage des URLs aux slugs).
  const project = useAccountStore((s) =>
    s.account.projects.find((p) => p.id === projectId || p.slug === projectId),
  );
  // Tout ce qui est en dessous cherche le project par ID : le slug de l'URL
  // s'arrête ici.
  const pId = (project?.id ?? projectId) as ProjectId;
  const activeLang = useUiStore((s) => s.activeLang);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const isDesktop = useIsDesktop();
  const eid = documentId as string;
  const menu = project?.menus.find((m) => m.id === eid);
  const command = project?.commands.find((c) => c.id === eid);
  const dialog = project?.dialogs.find((d) => d.id === eid);

  useEffect(() => {
    // Par défaut, sélectionne l'élément (menu/commande/dialog) lui-même. Mais si une
    // sélection cible déjà cet élément ou l'un de ses enfants — ex. la palette de
    // recherche qui sélectionne un item précis avant que cette vue ne monte — on la
    // préserve au lieu de l'écraser.
    const childIds = new Set<string>([documentId as string]);
    for (const layer of menu?.layers ?? []) for (const el of layer.elements ?? []) childIds.add(el.id);
    const current = useSelectionStore.getState().ids;
    const alreadyRelevant = current.size > 0 && [...current].every((id) => childIds.has(id));
    if (!alreadyRelevant) useSelectionStore.getState().set([documentId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const back = useCallback(
    () =>
      navigate({
        to: "/networks/$networkId/servers/$serverId/projects/$projectId",
        params: { networkId: params.networkId!, serverId: params.serverId!, projectId: projectId },
      }),
    [navigate, params.networkId, params.serverId, projectId],
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
        className="btn btn-ghost btn-sm inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="size-4" /> {t("documentView.back")}
        <kbd className="ml-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
          Esc
        </kbd>
      </button>
      <span className="truncate text-[13px] font-medium text-[var(--text)]">
        {project ? documentLabel(project, documentId as string, activeLang) : documentId}
      </span>
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

  return (
    <div className="absolute inset-0">
      {menu ? (
        isDesktop ? (
          // Stage full-bleed, edit pane floating over it — the board's layout.
          <>
            <div className="absolute inset-0">
              <SoloMenuStage projectId={pId} menuId={documentId as unknown as MenuId} />
            </div>
            <FloatingEditorPane
              projectId={pId}
              width={editorPaneWidth}
              onWidthChange={setEditorPaneWidth}
            />
          </>
        ) : (
          <SplitPane
            orientation="vertical"
            primary={<SoloMenuStage projectId={pId} menuId={documentId as unknown as MenuId} />}
            secondary={<EditorPane projectId={pId} />}
            secondarySize={editorPaneWidth}
            onSecondarySizeChange={setEditorPaneWidth}
            minSecondary={280}
            minPrimary={200}
          />
        )
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
