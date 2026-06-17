import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  LayoutGrid,
  MessageSquare,
  TerminalSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { type ElementType, type PackElementItem, buildPackElements } from "./usePackElements";

const TYPE_ICON: Record<ElementType, typeof LayoutGrid> = {
  menu: LayoutGrid,
  command: TerminalSquare,
  dialog: MessageSquare,
};
const TYPE_LABEL_KEY: Record<ElementType, string> = {
  menu: "workspacePanel.menus",
  command: "workspacePanel.commands",
  dialog: "workspacePanel.dialogs",
};

export function WorkspacePanel({ packId }: { packId: PackId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  if (!pack) return null;

  const groups = buildPackElements(pack, activeLang);
  const empty = groups.every((g) => g.items.length === 0);

  const openElement = (id: string) =>
    navigate({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      params: {
        networkId: params.networkId!,
        serverId: params.serverId!,
        workspaceId: packId,
        elementId: id,
      },
    });

  return (
    <nav className="flex h-full flex-col gap-2 overflow-auto p-2">
      {empty ? (
        <EmptyState title={t("workspacePanel.empty")} />
      ) : (
        groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.type} className="flex flex-col">
                <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
                  {t(TYPE_LABEL_KEY[g.type])}
                </div>
                {g.items.map((it) => (
                  <PanelItem
                    key={it.id}
                    packId={packId}
                    item={it}
                    onOpen={() => openElement(it.id)}
                  />
                ))}
              </div>
            ),
        )
      )}
    </nav>
  );
}

function PanelItem({
  packId,
  item,
  onOpen,
}: {
  packId: PackId;
  item: PackElementItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const Icon = TYPE_ICON[item.type];
  return (
    <div className="group flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-[var(--text-mut)] hover:text-[var(--text)]"
      >
        <Icon className="size-[15px] shrink-0 text-[var(--text-faint)]" />
        <span className="flex-1 truncate">{item.label}</span>
      </button>
      {item.onBoard ? (
        <button
          type="button"
          title={t("workspacePanel.removeFromCanvas")}
          aria-label={t("workspacePanel.removeFromCanvas")}
          onClick={() => useAccountStore.getState().removeFromBoard({ packId, nodeId: item.id })}
          className="flex shrink-0 items-center justify-center rounded-[8px] p-2 text-[var(--brand)] hover:bg-[var(--surface-raised)] hover:text-[var(--brand-hover)]"
        >
          <ArrowLeftToLine className="size-[15px]" />
        </button>
      ) : (
        <button
          type="button"
          title={t("workspacePanel.addToCanvas")}
          aria-label={t("workspacePanel.addToCanvas")}
          onClick={() =>
            useAccountStore.getState().addToBoard({ packId, nodeId: item.id, x: 40, y: 40 })
          }
          className="flex shrink-0 items-center justify-center rounded-[8px] p-2 text-[var(--text-faint)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)] lg:opacity-0 lg:group-hover:opacity-100"
        >
          <ArrowRightToLine className="size-[15px]" />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex shrink-0 items-center justify-center p-2 text-[var(--text-faint)]"
          aria-label={t("workspacePanel.options")}
        >
          ···
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onOpen}>{t("workspacePanel.edit")}</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              useAccountStore.getState().deleteFromPack({ packId, nodeIds: [item.id] })
            }
          >
            {t("workspacePanel.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
