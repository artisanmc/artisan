import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import type { Project, ProjectId } from "@/domain/types";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { NewDialogDialog } from "@/features/canvas/NewDialogDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { LayoutGrid, MessageSquare, Plus, Settings, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openProjectSettings } from "./projectSettings";
import {
  type DocumentType,
  type ProjectDocumentItem,
  buildProjectDocuments,
} from "./useProjectDocuments";

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

/**
 * Le registre d'un project : ses Documents groupés par type, ses paramètres et
 * la création. Un seul rendu, monté par la barre de gauche (sous le project
 * ouvert) et par le panneau de droite tant qu'il existe.
 *
 * `header="name"` : la ligne racine porte le nom du project (panneau seul).
 * `header="actions"` : le nom est déjà sur la ligne du project (barre de gauche),
 * on ne garde que paramètres et création.
 */
export function ProjectDocumentTree({
  projectId,
  onOpen,
  header = "name",
}: {
  projectId: ProjectId;
  onOpen: (documentId: string) => void;
  header?: "name" | "actions";
}) {
  const { t } = useTranslation();
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newCommandOpen, setNewCommandOpen] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  if (!project) return null;

  const empty =
    project.menus.length === 0 &&
    project.commands.length === 0 &&
    (project.dialogs ?? []).length === 0;

  return (
    <div
      role="group"
      aria-label={t("sidebar.projectDocuments", { name: project.name })}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <button
          type="button"
          data-testid="project-settings-row"
          onClick={openProjectSettings}
          title={t("projectProperties.title")}
          className={
            header === "name"
              ? "flex flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--text)]"
              : "flex flex-1 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[12px] text-[var(--text-mut)] hover:text-[var(--text)]"
          }
        >
          <Settings className="size-[15px] shrink-0 text-[var(--text-faint)]" />
          <span className="flex-1 truncate">
            {header === "name" ? project.name : t("projectProperties.title")}
          </span>
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
        <DocumentGroups project={project} onOpen={onOpen} editable />
      )}
    </div>
  );
}

/**
 * Les Documents d'un project groupés par type. `editable` ajoute le menu `···`
 * (éditer, supprimer) ; sans lui, une liste en lecture — un project du serveur
 * vu depuis l'index (état publié), qu'on ne modifie pas d'ici.
 */
export function DocumentGroups({
  project,
  onOpen,
  editable = false,
}: {
  project: Project;
  onOpen: (documentId: string) => void;
  editable?: boolean;
}) {
  const { t } = useTranslation();
  const activeLang = useUiStore((s) => s.activeLang);
  return (
    <>
      {buildProjectDocuments(project, activeLang).map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.type} className="flex flex-col">
              <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
                {t(TYPE_LABEL_KEY[g.type])}
              </div>
              {g.items.map((it) => (
                <DocumentRow
                  key={it.id}
                  projectId={editable ? project.id : null}
                  item={it}
                  onOpen={() => onOpen(it.id)}
                />
              ))}
            </div>
          ),
      )}
    </>
  );
}

function DocumentRow({
  projectId,
  item,
  onOpen,
}: {
  /** `null` = lecture seule : pas de menu d'actions. */
  projectId: ProjectId | null;
  item: ProjectDocumentItem;
  onOpen: () => void;
}) {
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
      {projectId !== null && <RowActions projectId={projectId} item={item} onOpen={onOpen} />}
    </div>
  );
}

function RowActions({
  projectId,
  item,
  onOpen,
}: {
  projectId: ProjectId;
  item: ProjectDocumentItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
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
  );
}
