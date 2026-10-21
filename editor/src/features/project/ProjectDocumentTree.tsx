import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { MAX_FOLDER_DEPTH } from "@/domain/documentLayout";
import { documentCount } from "@/domain/documents";
import { childFolders, folderName, listFolders } from "@/domain/folders";
import type { Project, ProjectId } from "@/domain/types";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { NewDialogDialog } from "@/features/canvas/NewDialogDialog";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { useModuleCommands } from "@/features/canvas/useModuleCommands";
import { ModuleTemplatesDialog } from "@/features/templates/ModuleTemplatesDialog";
import {
  type ProjectTemplates,
  useProjectTemplates,
} from "@/features/templates/useProjectTemplates";
import { contributionLabel } from "@/lib/moduleDocumentKinds";
import { useProjectsStore } from "@/state/projectsStore";
import { isKindSyncedOn, useServerDocumentKindsStore } from "@/state/serverDocumentKindsStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution, listDocumentKindContributions } from "@artisan/editor-sdk";
import type { TFunction } from "i18next";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  MessageSquare,
  Plus,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { documentRelPath } from "./DocumentYamlView";
import { FolderNameDialog } from "./FolderNameDialog";
import { ModuleCommandRow } from "./ModuleCommandRow";
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
  return contributionLabel(
    documentKindContribution(type),
    type,
    t,
    useUiStore.getState().editorLang,
  );
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
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const templates = useProjectTemplates(projectId);
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
          {templates.status !== "none" && (
            <DropdownMenuItem onSelect={() => setTemplatesOpen(true)}>
              {t("moduleTemplates.fromModule")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNewFolderOpen(true)}>
            {t("folders.newFolder")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FolderNameDialog
        projectId={projectId}
        parent=""
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
      />
      <NewMenuDialog projectId={projectId} open={newMenuOpen} onOpenChange={setNewMenuOpen} />
      <NewCommandDialog
        projectId={projectId}
        open={newCommandOpen}
        onOpenChange={setNewCommandOpen}
      />
      <NewDialogDialog projectId={projectId} open={newDialogOpen} onOpenChange={setNewDialogOpen} />
      {templatesOpen && (
        <ModuleTemplatesDialog projectId={projectId} open onOpenChange={setTemplatesOpen} />
      )}
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
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const { nodes: moduleCommands } = useModuleCommands(project);
  if (!project) return null;

  const empty =
    documentCount(project) === 0 &&
    listFolders(project).length === 0 &&
    moduleCommands.length === 0;

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
  const serverKinds = useServerDocumentKindsStore();
  const templates = useProjectTemplates(project.id);
  const groups = buildProjectDocuments(project, activeLang);
  const originOf = (id: string) => templateOrigin(templates, documentRelPath(project, id));
  // The commands the folder's module declares go with its own commands.
  const { nodes: moduleCommands } = useModuleCommands(project);
  const hasCommands = groups.some((g) => g.type === "command" && g.items.some((it) => !it.folder));
  const kinds =
    moduleCommands.length > 0 && !hasCommands
      ? [...groups, { type: "command" as DocumentType, items: [] as ProjectDocumentItem[] }]
      : groups;
  return (
    <>
      {childFolders(project, "").map((path) => (
        <FolderNode
          key={path}
          project={project}
          path={path}
          depth={0}
          groups={groups}
          onOpen={onOpen}
          editable={editable}
          originOf={originOf}
        />
      ))}
      {kinds.map((g) => {
        const rootItems = g.items.filter((it) => !it.folder);
        const moduleRows = g.type === "command" ? moduleCommands : [];
        if (rootItems.length === 0 && moduleRows.length === 0) return null;
        // One icon per category, in its header: repeated on every row it said
        // nothing more than the header and ate the width.
        const Icon = typeIcon(g.type);
        const label = typeLabel(g.type, t);
        // A module's kind the active server does not register: its files are not
        // read back there (W6). The core kinds are always read.
        const notSynced = !isCoreDocumentType(g.type) && !isKindSyncedOn(serverKinds, g.type);
        const notSyncedHint = notSynced
          ? t("projectPanel.kindNotSynced", { kind: label })
          : undefined;
        return (
          <div key={g.type} className="flex flex-col">
            <div
              className="flex items-center gap-1.5 px-2 pt-2 pb-0.5 text-[9.5px] font-semibold uppercase tracking-[.14em] text-[var(--text-faint)]"
              title={notSyncedHint}
            >
              <Icon className="size-3 shrink-0" aria-hidden />
              <span>{label}</span>
              {notSynced && (
                <span
                  role="img"
                  aria-label={notSyncedHint}
                  className="size-1.5 shrink-0 rounded-full bg-[var(--warning)]"
                />
              )}
            </div>
            <ul aria-label={label} className="flex flex-col">
              {rootItems.map((it) => (
                <li key={it.id}>
                  <DocumentRow
                    projectId={editable ? project.id : null}
                    project={project}
                    item={it}
                    onOpen={() => onOpen(it.id)}
                    origin={originOf(it.id)}
                  />
                </li>
              ))}
              {moduleRows.map((node) => (
                <li key={node.id}>
                  <ModuleCommandRow node={node} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

type OriginOf = (id: string) => ReturnType<typeof templateOrigin>;

/**
 * A themed folder: its sub-folders, then its Documents of every kind (each
 * with its kind's icon, since a folder mixes them). Open by default.
 */
function FolderNode({
  project,
  path,
  depth,
  groups,
  onOpen,
  editable,
  originOf,
}: {
  project: Project;
  path: string;
  depth: number;
  groups: ReturnType<typeof buildProjectDocuments>;
  onOpen: (documentId: string) => void;
  editable: boolean;
  originOf: OriginOf;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [dialog, setDialog] = useState<"sub" | "rename" | null>(null);
  const items = groups.flatMap((g) => g.items.filter((it) => it.folder === path));
  const Chevron = open ? ChevronDown : ChevronRight;
  const Icon = open ? FolderOpen : Folder;
  return (
    <div className="flex flex-col">
      <div className="group flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[10px] py-1 pr-2 text-left text-[12.5px] leading-5 text-[var(--text)]"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <Chevron className="size-3 shrink-0 text-[var(--text-faint)]" aria-hidden />
          <Icon className="size-3.5 shrink-0 text-[var(--text-mut)]" aria-hidden />
          <span className="flex-1 truncate">{folderName(path)}</span>
        </button>
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex shrink-0 items-center justify-center px-2 py-1 text-[var(--text-faint)] hover:text-[var(--text)] lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100"
              aria-label={t("folders.options")}
            >
              ···
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {depth + 1 < MAX_FOLDER_DEPTH && (
                <DropdownMenuItem onSelect={() => setDialog("sub")}>
                  {t("folders.newSubfolder")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => useUiStore.getState().setBoardFolder(project.id, path)}
              >
                {t("folders.showOnly")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("rename")}>
                {t("folders.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem
                title={t("folders.deleteHint")}
                onSelect={() =>
                  useProjectsStore.getState().deleteFolder({ projectId: project.id, path })
                }
              >
                {t("folders.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open && (
        <>
          {childFolders(project, path).map((child) => (
            <FolderNode
              key={child}
              project={project}
              path={child}
              depth={depth + 1}
              groups={groups}
              onOpen={onOpen}
              editable={editable}
              originOf={originOf}
            />
          ))}
          <ul aria-label={folderName(path)} className="flex flex-col">
            {items.map((it) => (
              <li key={`${it.type}:${it.id}`}>
                <DocumentRow
                  projectId={editable ? project.id : null}
                  project={project}
                  item={it}
                  depth={depth + 1}
                  icon={typeIcon(it.type)}
                  onOpen={() => onOpen(it.id)}
                  origin={originOf(it.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {editable && dialog !== null && (
        <FolderNameDialog
          projectId={project.id}
          parent={dialog === "sub" ? path : path.slice(0, Math.max(0, path.lastIndexOf("/")))}
          renaming={dialog === "rename" ? path : undefined}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </div>
  );
}

/** A Document copied from a module template: the dot after its name, and what it says. */
interface TemplateOrigin {
  tone: "update" | "modified" | "identical";
  label: string;
}

function templateOrigin(
  templates: ProjectTemplates,
  path: string | null,
): (Omit<TemplateOrigin, "label"> & { module: string }) | null {
  const entry = path ? templates.byPath[path] : undefined;
  if (!entry || entry.file.status === "removed") return null;
  const tone = entry.file.updateAvailable
    ? "update"
    : entry.file.status === "modified"
      ? "modified"
      : "identical";
  return { tone, module: entry.template.moduleId };
}

const ORIGIN_DOT: Record<TemplateOrigin["tone"], string> = {
  update: "bg-[var(--warning)]",
  modified: "bg-[var(--brand)]",
  identical: "bg-[var(--success)]",
};

function DocumentRow({
  projectId,
  project,
  item,
  onOpen,
  origin,
  depth = 0,
  icon: Icon,
}: {
  /** `null` = read-only: no actions menu. */
  projectId: ProjectId | null;
  project: Project;
  item: ProjectDocumentItem;
  onOpen: () => void;
  origin?: (Omit<TemplateOrigin, "label"> & { module: string }) | null;
  /** Folder depth: 0 under a kind header at the module root. */
  depth?: number;
  /** The kind's icon, shown where no kind header says it (inside a folder). */
  icon?: KindIcon;
}) {
  const { t } = useTranslation();
  const originLabel = origin
    ? t(`moduleTemplates.badge.${origin.tone}`, { module: origin.module })
    : undefined;
  return (
    <div className="group flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[10px] py-1 pr-2 text-left text-[12.5px] leading-5 text-[var(--text-mut)] hover:text-[var(--text)]"
        style={{ paddingLeft: 24 + depth * 12 }}
      >
        {Icon && <Icon className="size-3 shrink-0 text-[var(--text-faint)]" aria-hidden />}
        <span className="flex-1 truncate">{item.label}</span>
        {origin && (
          <span
            role="img"
            aria-label={originLabel}
            title={originLabel}
            className={`ml-1 size-1.5 shrink-0 rounded-full ${ORIGIN_DOT[origin.tone]}`}
          />
        )}
      </button>
      {projectId !== null && (
        <RowActions projectId={projectId} project={project} item={item} onOpen={onOpen} />
      )}
    </div>
  );
}

function RowActions({
  projectId,
  project,
  item,
  onOpen,
}: {
  projectId: ProjectId;
  project: Project;
  item: ProjectDocumentItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const targets = ["", ...listFolders(project)].filter((f) => f !== item.folder);
  const move = (folder: string) =>
    useProjectsStore.getState().moveToFolder({ projectId, nodeIds: [item.id], folder });
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
        {targets.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t("folders.moveTo")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {targets.map((folder) => (
                <DropdownMenuItem key={folder || "/"} onSelect={() => move(folder)}>
                  {folder || t("folders.root")}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem
          onClick={() =>
            useProjectsStore.getState().deleteFromProject({ projectId, nodeIds: [item.id] })
          }
        >
          {t("projectPanel.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
