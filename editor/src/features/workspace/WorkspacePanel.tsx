import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGrid, MessageSquare, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ElementType, type PackElementItem, buildPackElements } from "./usePackElements";

export const PANEL_DRAG_PREFIX = "panel:";
const TYPE_ICON: Record<ElementType, typeof LayoutGrid> = {
  menu: LayoutGrid,
  command: TerminalSquare,
  dialog: MessageSquare,
};

export function WorkspacePanel({ packId }: { packId: PackId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  const [q, setQ] = useState("");
  if (!pack) return null;

  const groups = buildPackElements(pack, activeLang).map((g) => ({
    ...g,
    items: g.items.filter((it) => it.label.toLowerCase().includes(q.toLowerCase())),
  }));
  const empty = groups.every((g) => g.items.length === 0);

  const openElement = (id: string) =>
    // The element route is added in Task 10; cast until routeTree.gen.ts knows it.
    navigate({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      params: {
        networkId: params.networkId!,
        serverId: params.serverId!,
        workspaceId: packId,
        elementId: id,
      },
    } as unknown as Parameters<typeof navigate>[0]);

  return (
    <nav className="flex h-full flex-col gap-2 overflow-auto p-2">
      <Input
        placeholder={t("workspacePanel.search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {empty ? (
        <EmptyState title={t("workspacePanel.empty")} />
      ) : (
        groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.type} className="flex flex-col">
                <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
                  {t(
                    `workspacePanel.${g.type === "menu" ? "menus" : g.type === "command" ? "commands" : "dialogs"}`,
                  )}
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PANEL_DRAG_PREFIX}${item.id}`,
    data: { nodeId: item.id, type: item.type },
  });
  return (
    <div
      className="group flex items-center gap-1 rounded-[10px] hover:bg-[var(--surface-hover)]"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-[var(--text-mut)] hover:text-[var(--text)]"
      >
        <Icon className="size-[15px] shrink-0 text-[var(--text-faint)]" />
        <span className="flex-1 truncate">{item.label}</span>
        {item.onBoard && (
          <span className="shrink-0 text-[9px] text-[var(--brand)]">
            {t("workspacePanel.onBoard")}
          </span>
        )}
      </button>
      <span
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className="w-5 shrink-0 cursor-grab touch-none text-center text-[var(--text-faint)]"
        aria-label="drag"
      >
        ⋮⋮
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger className="w-5 shrink-0 text-[var(--text-faint)]">
          ···
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onOpen}>{t("workspacePanel.edit")}</DropdownMenuItem>
          {item.onBoard ? (
            <DropdownMenuItem
              onClick={() =>
                useAccountStore.getState().removeFromBoard({ packId, nodeId: item.id })
              }
            >
              {t("workspacePanel.removeFromBoard")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                useAccountStore.getState().addToBoard({ packId, nodeId: item.id, x: 40, y: 40 })
              }
            >
              {t("workspacePanel.addToBoard")}
            </DropdownMenuItem>
          )}
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
