import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ElementId, MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { EmptyState } from "@/components/ui/empty-state";
import { SplitPane } from "@/components/SplitPane";
import { EditorPane } from "@/features/canvas/EditorPane";
import { SoloMenuStage } from "./SoloMenuStage";

export function ElementView({ packId, elementId }: { packId: PackId; elementId: ElementId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const eid = elementId as string;
  const menu = pack?.menus.find((m) => m.id === eid);
  const command = pack?.commands.find((c) => c.id === eid);
  const dialog = pack?.dialogs.find((d) => d.id === eid);
  const [secondarySize, setSecondarySize] = useState(320);

  useEffect(() => {
    useSelectionStore.getState().set([elementId]);
  }, [elementId]);

  const back = () =>
    navigate({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
      params: { networkId: params.networkId!, serverId: params.serverId!, workspaceId: packId },
    });

  const header = (
    <header className="flex h-[52px] shrink-0 items-center gap-3 px-4">
      <button
        type="button"
        onClick={back}
        className="btn btn-ghost btn-sm inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="size-4" /> {t("elementView.back")}
      </button>
      <span className="truncate text-[14px] font-medium text-[var(--text)]">{elementId}</span>
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
            secondarySize={secondarySize}
            onSecondarySizeChange={setSecondarySize}
            minSecondary={280}
            minPrimary={400}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState title={t("elementView.soon")} />
          </div>
        )}
      </div>
    </div>
  );
}
