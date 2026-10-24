import { Badge } from "@/components/ui/badge";
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
import { IconTile } from "@/components/ui/icon-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { MAX_FOLDER_DEPTH } from "@/domain/documentLayout";
import { docKey, documentCount } from "@/domain/documents";
import { childFolders, folderName, listFolders } from "@/domain/folders";
import type { Project, ProjectId } from "@/domain/types";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { NewDialogDialog } from "@/features/canvas/NewDialogDialog";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { ModuleTemplatesDialog } from "@/features/templates/ModuleTemplatesDialog";
import {
  type ProjectTemplates,
  useProjectTemplates,
} from "@/features/templates/useProjectTemplates";
import { copyTemplate } from "@/lib/api/templates";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { contributionLabel } from "@/lib/moduleDocumentKinds";
import { useProjectsStore } from "@/state/projectsStore";
import { isKindSyncedOn, useServerDocumentKindsStore } from "@/state/serverDocumentKindsStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution, listDocumentKindContributions } from "@artisan/editor-sdk";
import type { TFunction } from "i18next";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Plus,
  Puzzle,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { documentRelPath } from "./DocumentYamlView";
import { FolderNameDialog } from "./FolderNameDialog";
import { openProjectSettings } from "./projectSettings";
import {
  type DocumentType,
  type ProjectDocumentItem,
  buildProjectDocuments,
  isCoreDocumentType,
} from "./useProjectDocuments";

const TYPE_LABEL_KEY: Record<string, string> = {
  menu: "projectPanel.menus",
  command: "projectPanel.commands",
  dialog: "projectPanel.dialogs",
};

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

/** A kind's tile in its colour: what says a row is a menu, a command, a dialog… */
function KindGlyph({ kind }: { kind: DocumentType }) {
  const look = kindAppearance(kind);
  return (
    <span className="flex shrink-0" aria-hidden>
      <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="xs" />
    </span>
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
 * A project's registry: its Documents, each with its kind's tile.
 *
 * `header="name"`: a row with the project name and its actions (demo, where
 * no project row carries them). `header="none"`: the project's row in the
 * left bar already carries the name and actions.
 */
export function ProjectDocumentTree({
  projectId,
  onOpen,
  header = "name",
  activeId,
}: {
  projectId: ProjectId;
  /** Its argument: the Document's key (`docKey`). */
  onOpen: (documentId: string) => void;
  header?: "name" | "none";
  /** The key (`docKey`) of the Document open in the view, highlighted in the tree. */
  activeId?: string;
}) {
  const { t } = useTranslation();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  if (!project) return null;

  const empty = documentCount(project) === 0 && listFolders(project).length === 0;

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
        <DocumentGroups project={project} onOpen={onOpen} editable activeId={activeId} />
      )}
    </div>
  );
}

/**
 * A project's Documents, kind after kind, without a header per kind. `editable` adds the `···` menu
 * (edit, delete); without it, a read-only list — a server project seen
 * through the index (published state), not modified from here.
 */
export function DocumentGroups({
  project,
  onOpen,
  editable = false,
  activeId,
}: {
  project: Project;
  /** Its argument: the Document's key (`docKey`). */
  onOpen: (documentId: string) => void;
  editable?: boolean;
  activeId?: string;
}) {
  const { t } = useTranslation();
  const activeLang = useUiStore((s) => s.activeLang);
  const serverKinds = useServerDocumentKindsStore();
  const templates = useProjectTemplates(project.id);
  const groups = buildProjectDocuments(project, activeLang);
  const originOf = (id: string) => templateOrigin(templates, documentRelPath(project, id), t);
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
          activeId={activeId}
        />
      ))}
      {groups.map((g) => {
        const rootItems = g.items.filter((it) => !it.folder);
        if (rootItems.length === 0) return null;
        // No kind header: each row wears its kind's tile, and the kinds follow each
        // other in a fixed order, a little apart.
        const label = typeLabel(g.type, t);
        // A module's kind the active server does not register: its files are not
        // read back there (W6). The core kinds are always read.
        const notSynced = !isCoreDocumentType(g.type) && !isKindSyncedOn(serverKinds, g.type);
        const notSyncedHint = notSynced
          ? t("projectPanel.kindNotSynced", { kind: label })
          : undefined;
        return (
          <div key={g.type} className="flex flex-col pb-1.5 last:pb-0">
            <ul aria-label={label} className="flex flex-col">
              {rootItems.map((it) => (
                <li key={it.id}>
                  <DocumentRow
                    projectId={editable ? project.id : null}
                    project={project}
                    item={it}
                    kind={g.type}
                    onOpen={() => onOpen(docKey(g.type, it.id))}
                    origin={originOf(docKey(g.type, it.id))}
                    notSyncedHint={notSyncedHint}
                    activeId={activeId}
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
  activeId,
}: {
  project: Project;
  path: string;
  depth: number;
  groups: ReturnType<typeof buildProjectDocuments>;
  /** Its argument: the Document's key (`docKey`). */
  onOpen: (documentId: string) => void;
  editable: boolean;
  originOf: OriginOf;
  activeId?: string;
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
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[10px] py-[5px] pr-2 text-left text-[13px] font-medium leading-5 text-[var(--text)]"
          style={{ paddingLeft: 2 + depth * 14 }}
        >
          <Chevron className="size-3 shrink-0 text-[var(--text-faint)]" aria-hidden />
          <Icon className="size-4 shrink-0 text-[var(--text-mut)]" aria-hidden />
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
              activeId={activeId}
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
                  kind={it.type}
                  onOpen={() => onOpen(docKey(it.type, it.id))}
                  origin={originOf(docKey(it.type, it.id))}
                  activeId={activeId}
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

type DocumentOrigin = Omit<TemplateOrigin, "label"> & {
  module: string;
  /** One of the module's system elements: never deleted or moved, reset instead. */
  system: boolean;
  /** Puts the module's version back; absent while it cannot be written (unsaved changes). */
  reset?: () => void;
};

function templateOrigin(
  templates: ProjectTemplates,
  path: string | null,
  t: TFunction,
): DocumentOrigin | null {
  const entry = path ? templates.byPath[path] : undefined;
  if (!path || !entry || entry.file.status === "removed") return null;
  const tone = entry.file.updateAvailable
    ? "update"
    : entry.file.status === "modified"
      ? "modified"
      : "identical";
  const system = entry.template.template.system === true;
  const { target } = templates;
  const reset =
    system && tone !== "identical" && target && !templates.dirty
      ? () => {
          if (!window.confirm(t("projectPanel.systemResetConfirm"))) return;
          void copyTemplate(target, {
            module: entry.template.moduleId,
            template: entry.template.template.id,
            paths: [path],
            replace: true,
          }).then((result) => {
            if (result.ok) templates.refresh();
            else
              toast.error(
                t(
                  `moduleTemplates.errors.${result.error}`,
                  t("moduleTemplates.errors.fetch_error"),
                ),
              );
          });
        }
      : undefined;
  return { tone, module: entry.template.moduleId, system, ...(reset ? { reset } : {}) };
}

/** What a copy's tag says in a word: nothing when it is the module's version as is. */
const ORIGIN_TAG: Record<TemplateOrigin["tone"], "amber" | "terra" | null> = {
  update: "amber",
  modified: "terra",
  identical: null,
};

function DocumentRow({
  projectId,
  project,
  item,
  onOpen,
  origin,
  depth = 0,
  kind,
  notSyncedHint,
  activeId,
}: {
  /** `null` = read-only: no actions menu. */
  projectId: ProjectId | null;
  project: Project;
  item: ProjectDocumentItem;
  onOpen: () => void;
  origin?: DocumentOrigin | null;
  /** Folder depth: 0 at the module root. */
  depth?: number;
  /** The kind, whose coloured tile leads the row. */
  kind: DocumentType;
  /** Set when the active server does not read this kind back: a warning dot says so. */
  notSyncedHint?: string;
  /** The Document open in the view, highlighted. */
  activeId?: string;
}) {
  const { t } = useTranslation();
  const active = activeId === docKey(kind, item.id);
  const look = kindAppearance(kind);
  const originLabel = origin
    ? t(
        origin.system
          ? `projectPanel.systemBadge.${origin.tone}`
          : `moduleTemplates.badge.${origin.tone}`,
        {
          module: origin.module,
        },
      )
    : undefined;
  const systemHint = origin?.system
    ? t("projectPanel.systemDocumentHint", { module: origin.module })
    : undefined;
  return (
    <div
      className={`group flex items-center gap-0.5 rounded-[10px] ${active ? "" : "hover:bg-[var(--surface-hover)]"}`}
      style={active ? { background: look.soft } : undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-[10px] py-[5px] pr-2 text-left text-[13px] leading-5 ${
          active ? "font-semibold text-[var(--text)]" : "text-[var(--text)]"
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <KindGlyph kind={kind} />
        <span className="flex-1 truncate">{item.label}</span>
        {notSyncedHint && (
          <span
            role="img"
            aria-label={notSyncedHint}
            title={notSyncedHint}
            className="size-1.5 shrink-0 rounded-full bg-[var(--warning)]"
          />
        )}
        {origin && ORIGIN_TAG[origin.tone] ? (
          <Badge
            variant={ORIGIN_TAG[origin.tone]}
            role="img"
            title={originLabel}
            aria-label={originLabel}
            className="shrink-0 !h-[17px] !px-1.5 text-[10.5px]"
          >
            {t(`projectPanel.originTag.${origin.tone}`)}
          </Badge>
        ) : null}
        {/* A plain copy of a module's template, unchanged: the puzzle says where it comes from. */}
        {origin && !origin.system && origin.tone === "identical" && (
          <Tooltip content={originLabel} side="right">
            <span role="img" aria-label={originLabel} className="flex shrink-0">
              <Puzzle className="size-3 text-[var(--text-faint)]" aria-hidden />
            </span>
          </Tooltip>
        )}
        {systemHint && (
          <Tooltip content={systemHint} side="right">
            <span role="img" aria-label={systemHint} className="flex shrink-0">
              <Puzzle className="size-3 text-[var(--text-faint)]" aria-hidden />
            </span>
          </Tooltip>
        )}
      </button>
      {projectId !== null && (
        <RowActions
          projectId={projectId}
          project={project}
          item={item}
          onOpen={onOpen}
          system={origin?.system === true}
          onReset={origin?.reset}
        />
      )}
    </div>
  );
}

function RowActions({
  projectId,
  project,
  item,
  onOpen,
  system,
  onReset,
}: {
  projectId: ProjectId;
  project: Project;
  item: ProjectDocumentItem;
  onOpen: () => void;
  /** A module's system element: kept where the module put it, never deleted. */
  system: boolean;
  onReset?: () => void;
}) {
  const { t } = useTranslation();
  const targets = system ? [] : ["", ...listFolders(project)].filter((f) => f !== item.folder);
  const move = (folder: string) =>
    useProjectsStore
      .getState()
      .moveToFolder({ projectId, nodeIds: [docKey(item.type, item.id)], folder });
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
        {system ? (
          <DropdownMenuItem
            disabled={!onReset}
            title={t("projectPanel.systemResetHint")}
            onClick={onReset}
          >
            {t("projectPanel.systemReset")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() =>
              useProjectsStore
                .getState()
                .deleteFromProject({ projectId, nodeIds: [docKey(item.type, item.id)] })
            }
          >
            {t("projectPanel.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
