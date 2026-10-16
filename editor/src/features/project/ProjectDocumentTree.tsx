import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { documentCount } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { NewDialogDialog } from "@/features/canvas/NewDialogDialog";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution, listDocumentKindContributions } from "@artisan/editor-sdk";
import type { TFunction } from "i18next";
import { FileText, LayoutGrid, MessageSquare, Plus, Settings, TerminalSquare } from "lucide-react";
import { useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { openProjectSettings } from "./projectSettings";
import {
  type DocumentType,
  type ProjectDocumentItem,
  buildProjectDocuments,
  isCoreDocumentType,
} from "./useProjectDocuments";

type KindIcon = ComponentType<{ className?: string }>;
const TYPE_ICON: Record<string, KindIcon> = {
  menu: LayoutGrid,
  command: TerminalSquare,
  dialog: MessageSquare,
};
const TYPE_LABEL_KEY: Record<string, string> = {
  menu: "projectPanel.menus",
  command: "projectPanel.commands",
  dialog: "projectPanel.dialogs",
};

/** A kind's icon: the core table, else its contribution, else a plain file. */
function typeIcon(type: DocumentType): KindIcon {
  return TYPE_ICON[type] ?? documentKindContribution(type)?.icon ?? FileText;
}
/** A kind's group label: the core key, else the contribution's (an i18n key or a literal), else the kind. */
function typeLabel(type: DocumentType, t: TFunction): string {
  const key = TYPE_LABEL_KEY[type];
  if (key) return t(key);
  const label = documentKindContribution(type)?.label ?? type;
  return t(label, { defaultValue: label });
}

/**
 * A project's settings and creation: two icon buttons, to the right of the
 * project name (left bar row, or tree header).
 */
export function ProjectActions({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newCommandOpen, setNewCommandOpen] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  // A module's kind: one "+" entry and one dialog per contribution.
  const [newKind, setNewKind] = useState<string | null>(null);
  const moduleKinds = listDocumentKindContributions().filter((c) => !isCoreDocumentType(c.kind));
  const iconButton =
    "flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-faint)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]";
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
          {moduleKinds.map((c) => (
            <DropdownMenuItem key={c.kind} onSelect={() => setNewKind(c.kind)}>
              {t("projectProperties.newDocument", { kind: typeLabel(c.kind, t) })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <NewMenuDialog projectId={projectId} open={newMenuOpen} onOpenChange={setNewMenuOpen} />
      <NewCommandDialog
        projectId={projectId}
        open={newCommandOpen}
        onOpenChange={setNewCommandOpen}
      />
      <NewDialogDialog projectId={projectId} open={newDialogOpen} onOpenChange={setNewDialogOpen} />
      {newKind !== null && (
        <NewDocumentDialog
          projectId={projectId}
          kind={newKind}
          open
          onOpenChange={(open) => {
            if (!open) setNewKind(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * A project's registry: its Documents grouped by type.
 *
 * `header="name"`: a row with the project name and its actions (demo, where
 * no project row carries them). `header="none"`: the project's row in the
 * left bar already carries the name and actions.
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

  const empty = documentCount(project) === 0;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a named group of navigation lists, not a form — <fieldset> would be wrong.
    <div
      role="group"
      aria-label={t("sidebar.projectDocuments", { name: project.name })}
      className="flex flex-col gap-0.5"
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
 * A project's Documents grouped by type. `editable` adds the `···` menu
 * (edit, delete); without it, a read-only list — a server project seen
 * through the index (published state), not modified from here.
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
        // One icon per category, in its header: repeated on every row it said
        // nothing more than the header and ate the width.
        const Icon = typeIcon(g.type);
        const label = typeLabel(g.type, t);
        return (
          <div key={g.type} className="flex flex-col">
            <div className="flex items-center gap-1.5 px-2 pt-2 pb-0.5 text-[9.5px] font-semibold uppercase tracking-[.14em] text-[var(--text-faint)]">
              <Icon className="size-3 shrink-0" aria-hidden />
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
  /** `null` = read-only: no actions menu. */
  projectId: ProjectId | null;
  item: ProjectDocumentItem;
  onOpen: () => void;
}) {
  return (
    <div className="group flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center rounded-[10px] py-1 pr-2 pl-6 text-left text-[12.5px] leading-5 text-[var(--text-mut)] hover:text-[var(--text)]"
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
        className="flex shrink-0 items-center justify-center px-2 py-1 text-[var(--text-faint)] hover:text-[var(--text)] lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100"
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
