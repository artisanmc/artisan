import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ElementId, MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { EmptyState } from "@/components/ui/empty-state";
import { SplitPane } from "@/components/SplitPane";
import { EditorPane } from "@/features/canvas/EditorPane";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { SoloMenuStage } from "./SoloMenuStage";
import { elementLabel } from "./usePackElements";

export function ElementView({ packId, elementId }: { packId: PackId; elementId: ElementId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const eid = elementId as string;
  const menu = pack?.menus.find((m) => m.id === eid);
  const command = pack?.commands.find((c) => c.id === eid);
  const dialog = pack?.dialogs.find((d) => d.id === eid);

  useEffect(() => {
    // Par défaut, sélectionne l'élément (menu/commande/dialog) lui-même. Mais si une
    // sélection cible déjà cet élément ou l'un de ses enfants — ex. la palette de
    // recherche qui sélectionne un item précis avant que cette vue ne monte — on la
    // préserve au lieu de l'écraser.
    const childIds = new Set<string>([elementId as string]);
    for (const layer of menu?.layers ?? []) for (const el of layer.elements ?? []) childIds.add(el.id);
    const current = useSelectionStore.getState().ids;
    const alreadyRelevant = current.size > 0 && [...current].every((id) => childIds.has(id));
    if (!alreadyRelevant) useSelectionStore.getState().set([elementId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId]);

  const back = useCallback(
    () =>
      navigate({
        to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
        params: { networkId: params.networkId!, serverId: params.serverId!, workspaceId: packId },
      }),
    [navigate, params.networkId, params.serverId, packId],
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

  const header = (
    <header className="flex h-[52px] shrink-0 items-center gap-3 px-4">
      <button
        type="button"
        onClick={back}
        className="btn btn-ghost btn-sm inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="size-4" /> {t("elementView.back")}
        <kbd className="ml-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
          Esc
        </kbd>
      </button>
      <span className="truncate text-[14px] font-medium text-[var(--text)]">{pack ? elementLabel(pack, elementId as string, activeLang) : elementId}</span>
    </header>
  );

  if (!pack || (!menu && !command && !dialog)) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center">
          <EmptyState title={t("elementView.notFound")} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1">
        {menu ? (
          <SplitPane
            orientation="horizontal"
            primary={<SoloMenuStage packId={packId} menuId={elementId as unknown as MenuId} />}
            secondary={<EditorPane packId={packId} />}
            secondarySize={editorPaneWidth}
            onSecondarySizeChange={setEditorPaneWidth}
            minSecondary={280}
            minPrimary={400}
          />
        ) : (
          <div className="mx-auto h-full w-full max-w-3xl overflow-auto">
            <FlowCanvas packId={packId} />
          </div>
        )}
      </div>
    </div>
  );
}
