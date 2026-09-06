import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  LayoutGrid,
  MessageSquare,
  Plus,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { NewDialogDialog } from "@/features/canvas/NewDialogDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { openProjectSettings } from "./projectSettings";
import { type DocumentType, type ProjectDocumentItem, buildProjectDocuments } from "./useProjectDocuments";

const TYPE_ICON: Record<DocumentType, typeof LayoutGrid> = {
  menu: LayoutGrid,
  command: TerminalSquare,
  dialog: MessageSquare,
};
const TYPE_LABEL_KEY: Record<DocumentType, string> = {
  menu: "projectPanel.menus",
  command: "projectPanel.commands",
  dialog: "projectPanel.dialogs",
};

export function ProjectPanel({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  // La création vit ici, dans le registre du project — et non plus dans le
  // panneau de droite, qui n'apparaît qu'à la sélection. Sans position : le
  // Document naît HORS planche, la curation reste un geste explicite.
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newCommandOpen, setNewCommandOpen] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  if (!project) return null;

  const groups = buildProjectDocuments(project, activeLang);
  const empty = groups.every((g) => g.items.length === 0);

  const openElement = (id: string) =>
    navigate({
      to: "/networks/$networkId/servers/$serverId/projects/$projectId/document/$documentId",
      params: {
        networkId: params.networkId!,
        serverId: params.serverId!,
        projectId: projectId,
        documentId: id,
      },
    });

  return (
    <nav className="flex h-full flex-col gap-2 overflow-auto p-2">
      <div className="flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <button
          type="button"
          data-testid="project-settings-row"
          onClick={openProjectSettings}
          title={t("projectProperties.title")}
          className="flex flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--text)]"
        >
          <Settings className="size-[15px] shrink-0 text-[var(--text-faint)]" />
          <span className="flex-1 truncate">{project.name}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="project-create"
            aria-label={t("projectProperties.newMenu")}
            className="flex shrink-0 items-center justify-center rounded-[8px] p-2 text-[var(--text-faint)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
          >
            <Plus className="size-[15px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setNewMenuOpen(true)}>
              {t("projectProperties.newMenu")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewCommandOpen(true)}>
              {t("projectProperties.newCommand")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewDialogOpen(true)}>
              {t("projectProperties.newDialog")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <NewMenuDialog projectId={projectId} open={newMenuOpen} onOpenChange={setNewMenuOpen} />
      <NewCommandDialog
        projectId={projectId}
        open={newCommandOpen}
        onOpenChange={setNewCommandOpen}
      />
      <NewDialogDialog projectId={projectId} open={newDialogOpen} onOpenChange={setNewDialogOpen} />
      {empty ? (
        <EmptyState title={t("projectPanel.empty")} />
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
                    projectId={projectId}
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
  projectId,
  item,
  onOpen,
}: {
  projectId: ProjectId;
  item: ProjectDocumentItem;
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
          title={t("projectPanel.removeFromCanvas")}
          aria-label={t("projectPanel.removeFromCanvas")}
          onClick={() => useAccountStore.getState().removeFromBoard({ projectId, nodeId: item.id })}
          className="flex shrink-0 items-center justify-center rounded-[8px] p-2 text-[var(--brand)] hover:bg-[var(--surface-raised)] hover:text-[var(--brand-hover)]"
        >
          <ArrowLeftToLine className="size-[15px]" />
        </button>
      ) : (
        <button
          type="button"
          title={t("projectPanel.addToCanvas")}
          aria-label={t("projectPanel.addToCanvas")}
          onClick={() =>
            useAccountStore.getState().addToBoard({ projectId, nodeId: item.id, x: 40, y: 40 })
          }
          className="flex shrink-0 items-center justify-center rounded-[8px] p-2 text-[var(--text-faint)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)] lg:opacity-0 lg:group-hover:opacity-100"
        >
          <ArrowRightToLine className="size-[15px]" />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex shrink-0 items-center justify-center p-2 text-[var(--text-faint)]"
          aria-label={t("projectPanel.options")}
        >
          ···
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onOpen}>{t("projectPanel.edit")}</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              useAccountStore.getState().deleteFromProject({ projectId, nodeIds: [item.id] })
            }
          >
            {t("projectPanel.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
