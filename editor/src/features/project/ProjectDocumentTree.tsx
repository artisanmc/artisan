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
 * Paramètres et création d'un project : deux boutons icône, posés à droite du
 * nom du project (ligne de la barre de gauche, ou en-tête de l'arbre).
 */
export function ProjectActions({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newCommandOpen, setNewCommandOpen] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const iconButton =
    "flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-faint)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]";
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        data-testid="project-settings"
        onClick={openProjectSettings}
        aria-label={t("projectProperties.title")}
        title={t("projectProperties.title")}
        className={iconButton}
      >
        <Settings className="size-[15px]" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="project-create"
          aria-label={t("projectProperties.create")}
          title={t("projectProperties.create")}
          className={iconButton}
        >
          <Plus className="size-[15px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
      <NewMenuDialog projectId={projectId} open={newMenuOpen} onOpenChange={setNewMenuOpen} />
      <NewCommandDialog
        projectId={projectId}
        open={newCommandOpen}
        onOpenChange={setNewCommandOpen}
      />
      <NewDialogDialog projectId={projectId} open={newDialogOpen} onOpenChange={setNewDialogOpen} />
    </div>
  );
}

/**
 * Le registre d'un project : ses Documents groupés par type.
 *
 * `header="name"` : une ligne avec le nom du project et ses actions (démo, où
 * aucune ligne de project ne les porte). `header="none"` : la ligne du project
 * dans la barre de gauche porte déjà nom et actions.
 */
export function ProjectDocumentTree({
  projectId,
  onOpen,
  header = "name",
}: {
  projectId: ProjectId;
  onOpen: (documentId: string) => void;
  header?: "name" | "none";
}) {
  const { t } = useTranslation();
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  if (!project) return null;

  const empty =
    project.menus.length === 0 &&
    project.commands.length === 0 &&
    (project.dialogs ?? []).length === 0;

  return (
    // biome-ignore lint/a11y/useSemanticElements: un groupe nommé de listes de navigation, pas un formulaire — <fieldset> serait faux.
    <div
      role="group"
      aria-label={t("sidebar.projectDocuments", { name: project.name })}
      className="flex flex-col gap-2"
    >
      {header === "name" && (
        <div className="flex items-center gap-1 px-2.5 py-1">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
            {project.name}
          </span>
          <ProjectActions projectId={projectId} />
        </div>
      )}
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
      {buildProjectDocuments(project, activeLang).map((g) => {
        if (g.items.length === 0) return null;
        // Une icône par catégorie, dans son en-tête : répétée sur chaque ligne,
        // elle ne disait rien de plus que l'en-tête et mangeait la largeur.
        const Icon = TYPE_ICON[g.type];
        const label = t(TYPE_LABEL_KEY[g.type]);
        return (
          <div key={g.type} className="flex flex-col">
            <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span>{label}</span>
            </div>
            <ul aria-label={label} className="flex flex-col">
              {g.items.map((it) => (
                <li key={it.id}>
                  <DocumentRow
                    projectId={editable ? project.id : null}
                    item={it}
                    onOpen={() => onOpen(it.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
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
  return (
    <div className="group flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center rounded-[10px] py-1.5 pr-2 pl-7 text-left text-[13px] text-[var(--text-mut)] hover:text-[var(--text)]"
      >
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
