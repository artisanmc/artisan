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
import { DEFAULT_GROUP_COLOR, folderGroups } from "@/domain/canvasGroups";
import { MAX_FOLDER_DEPTH } from "@/domain/documentLayout";
import { docKey, documentCount, findDocumentByKey } from "@/domain/documents";
import { childFolders, folderName, listFolders } from "@/domain/folders";
import { ownDataSources } from "@/domain/projectData";
import type { Project, ProjectId } from "@/domain/types";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { NewDialogDialog } from "@/features/canvas/NewDialogDialog";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { DataSourceRows } from "@/features/data/DataSourceRows";
import { ModuleTemplatesDialog } from "@/features/templates/ModuleTemplatesDialog";
import { sameAsShipped } from "@/features/templates/sameAsShipped";
import {
  type ProjectTemplates,
  useProjectTemplates,
} from "@/features/templates/useProjectTemplates";
import { collectionLabel, isCollectionKind, projectCollections } from "@/lib/documentCollections";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { contributionLabel, kindCreatableIn } from "@/lib/moduleDocumentKinds";
import { collectionDestination, dataSourceDestination } from "@/lib/projectNavigation";
import { shippedKey, useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { isKindSyncedOn, useServerDocumentKindsStore } from "@/state/serverDocumentKindsStore";
import { useUiStore } from "@/state/uiStore";
import {
  type DocumentKindContribution,
  documentKindContribution,
  listDocumentKindContributions,
} from "@artisan/editor-sdk";
import { useDraggable } from "@dnd-kit/core";
import { useNavigate, useParams } from "@tanstack/react-router";
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
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { documentRelPath } from "./DocumentYamlView";
import { FolderNameDialog } from "./FolderNameDialog";
import {
  DocumentDragArea,
  useDocumentDrag,
  useFolderDroppable,
  useGlidingRows,
  withDropPreview,
} from "./documentDrag";
import { useOpenProjectSettings } from "./projectSettings";
import { adoptDiskIntoProject } from "./saveProjectToDisk";
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
  const openProjectSettings = useOpenProjectSettings();
  const templates = useProjectTemplates(projectId);
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const navigate = useNavigate();
  const { serverId } = useParams({ strict: false }) as { serverId?: string };
  // A Project's own data: created empty, then named and shaped on its page.
  const newData = (shape: "table" | "config") => {
    const id = useProjectsStore.getState().addProjectDataSource({ projectId, shape });
    if (id && serverId) void navigate(dataSourceDestination(project ?? projectId, serverId, id));
  };
  // A kind may be reserved to its module's own folder (`projects`, SDK 1.8).
  const moduleKinds = listDocumentKindContributions().filter(
    (c) => !isCoreDocumentType(c.kind) && kindCreatableIn(c, project),
  );
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
          <DropdownMenuItem data-testid="project-create-table" onSelect={() => newData("table")}>
            {t("dataSources.newTable")}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="project-create-config" onSelect={() => newData("config")}>
            {t("dataSources.newConfig")}
          </DropdownMenuItem>
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

  const empty =
    documentCount(project) === 0 &&
    listFolders(project).length === 0 &&
    ownDataSources(project).length === 0;

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
        <DocumentDragArea
          projectId={project.id}
          overlay={(key) => <DragGhost project={project} docKeyOf={key} />}
        >
          <DocumentGroups project={project} onOpen={onOpen} editable activeId={activeId} />
        </DocumentDragArea>
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
  const drag = useDocumentDrag();
  // While a Document is dragged, the tree already shows it where it would land.
  const allGroups = withDropPreview(buildProjectDocuments(project, activeLang), drag, (it) =>
    docKey(it.type, it.id),
  );
  // A collection's Documents are listed under its own entry, never at the root or in a folder.
  const groups = allGroups.filter((g) => !isCollectionKind(g.type));
  const collections = projectCollections(project);
  const originOf = (id: string) =>
    templateOrigin(templates, project, documentRelPath(project, id), t);
  // Dropped outside every folder: back to the module's root.
  const root = useFolderDroppable("", editable);
  const container = useRef<HTMLDivElement>(null);
  useGlidingRows(container, drag.key !== null);
  return (
    <div
      ref={(node) => {
        container.current = node;
        root.setNodeRef(node);
      }}
      className={`flex flex-col gap-0.5 rounded-[10px] ${drag.target === "" ? DROP_RING : ""}`}
    >
      {collections.map((c) => (
        <CollectionNode
          key={c.kind}
          project={project}
          contribution={c}
          items={allGroups.find((g) => g.type === c.kind)?.items ?? []}
          onOpen={onOpen}
          editable={editable}
          originOf={originOf}
          activeId={activeId}
        />
      ))}
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
                <li key={it.id} data-flip={docKey(g.type, it.id)}>
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
      <DataSourceRows project={project} editable={editable} />
    </div>
  );
}

const DROP_RING = "outline outline-1 outline-[var(--brand)] bg-[var(--brand-soft)]";

/** The row that follows the pointer while a Document is dragged. */
function DragGhost({ project, docKeyOf }: { project: Project; docKeyOf: string }) {
  const found = findDocumentByKey(project, docKeyOf);
  if (!found) return null;
  return (
    <div
      className="flex cursor-grabbing items-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-[5px] text-[13px] leading-5 text-[var(--text)]"
      style={{ boxShadow: "var(--shadow-lg)" }}
    >
      <KindGlyph kind={found.kind} />
      <span className="truncate">{found.doc.id}</span>
    </div>
  );
}

type OriginOf = (id: string) => ReturnType<typeof templateOrigin>;

/**
 * The color of the board frame a folder lives in: its top-level folder's, while that
 * folder holds a Document (a frame); none for a folder the board does not show.
 */
function frameColor(project: Project, path: string): string | undefined {
  const top = path.split("/")[0]!;
  const frame = folderGroups(project).find((g) => g.id === top);
  return frame ? (frame.color ?? DEFAULT_GROUP_COLOR) : undefined;
}

/**
 * A collection (SDK 1.9), a shop's catalogue: one entry, never renamed nor deleted, whose
 * name opens its page and whose "+" creates a Document of its kind. Its Documents stay
 * where their module reads them: no drag, no "Move to".
 */
function CollectionNode({
  project,
  contribution,
  items,
  onOpen,
  editable,
  originOf,
  activeId,
}: {
  project: Project;
  contribution: DocumentKindContribution;
  items: ProjectDocumentItem[];
  /** Its argument: the Document's key (`docKey`). */
  onOpen: (documentId: string) => void;
  editable: boolean;
  originOf: OriginOf;
  activeId?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverId, collectionDir } = useParams({ strict: false }) as {
    serverId?: string;
    collectionDir?: string;
  };
  const uiLang = useUiStore((s) => s.editorLang);
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const kind = contribution.kind;
  const label = collectionLabel(contribution, kind, uiLang);
  const look = kindAppearance(kind);
  const Chevron = open ? ChevronDown : ChevronRight;
  const active = collectionDir === contribution.dir;
  const canOpen = editable && !!serverId;
  return (
    <div className="flex flex-col">
      <div
        className={`group flex items-center gap-0.5 rounded-[10px] ${active ? "" : "hover:bg-[var(--surface-hover)]"}`}
        style={active ? { background: look.soft } : undefined}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={t(open ? "collections.collapse" : "collections.expand", {
            collection: label,
          })}
          onClick={() => setOpen(!open)}
          className="flex shrink-0 items-center py-[5px] pl-0.5"
        >
          <Chevron className="size-3 text-[var(--text-faint)]" aria-hidden />
        </button>
        <button
          type="button"
          data-testid={`collection-${kind}`}
          aria-current={active ? "page" : undefined}
          title={canOpen ? t("collections.open", { collection: label }) : undefined}
          onClick={() =>
            canOpen ? navigate(collectionDestination(project, serverId!, kind)) : setOpen(!open)
          }
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-[10px] py-[5px] pr-2 text-left text-[13px] leading-5 text-[var(--text)] ${active ? "font-semibold" : "font-medium"}`}
        >
          <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="xs" />
          <span className="flex-1 truncate">{label}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{items.length}</span>
        </button>
        {editable && kindCreatableIn(contribution, project) && (
          <button
            type="button"
            data-testid={`collection-${kind}-create`}
            onClick={() => setCreating(true)}
            aria-label={t("projectProperties.newDocument", { kind: typeLabel(kind, t) })}
            title={t("projectProperties.newDocument", { kind: typeLabel(kind, t) })}
            className="flex shrink-0 items-center justify-center px-2 py-1 text-[var(--text-faint)] hover:text-[var(--text)] lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          >
            <Plus className="size-[14px]" />
          </button>
        )}
      </div>
      {open && items.length > 0 && (
        <ul aria-label={label} className="flex flex-col">
          {items.map((it) => (
            <li key={it.id}>
              <DocumentRow
                projectId={editable ? project.id : null}
                project={project}
                item={it}
                depth={1}
                kind={kind}
                fixed
                onOpen={() => onOpen(docKey(kind, it.id))}
                origin={originOf(docKey(kind, it.id))}
                activeId={activeId}
              />
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <NewDocumentDialog
          projectId={project.id}
          kind={kind}
          open
          onOpenChange={(o) => {
            if (!o) setCreating(false);
          }}
          onCreated={(id) => onOpen(docKey(kind, id))}
        />
      )}
    </div>
  );
}

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
  const drag = useDocumentDrag();
  const drop = useFolderDroppable(path, editable);
  // A folded folder opens when a Document is dragged over it.
  useEffect(() => {
    if (drop.isOver) setOpen(true);
  }, [drop.isOver]);
  const [dialog, setDialog] = useState<"sub" | "rename" | null>(null);
  const items = groups.flatMap((g) => g.items.filter((it) => it.folder === path));
  const Chevron = open ? ChevronDown : ChevronRight;
  const Icon = open ? FolderOpen : Folder;
  const color = frameColor(project, path);
  return (
    <div
      ref={drop.setNodeRef}
      className={`flex flex-col rounded-[10px] ${drag.target === path ? DROP_RING : ""}`}
    >
      <div className="group flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[10px] py-[5px] pr-2 text-left text-[13px] font-medium leading-5 text-[var(--text)]"
          style={{ paddingLeft: 2 + depth * 14 }}
        >
          <Chevron className="size-3 shrink-0 text-[var(--text-faint)]" aria-hidden />
          <Icon
            className="size-4 shrink-0 text-[var(--text-mut)]"
            style={color ? { color } : undefined}
            aria-hidden
          />
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
              <li key={`${it.type}:${it.id}`} data-flip={docKey(it.type, it.id)}>
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
  /** Puts the module's version back into the draft; absent when it already is. A system file and a copy alike. */
  reset?: () => void;
};

function templateOrigin(
  templates: ProjectTemplates,
  project: Project,
  path: string | null,
  t: TFunction,
): DocumentOrigin | null {
  const entry = path ? templates.byPath[path] : undefined;
  if (!path || !entry || entry.file.status === "removed") return null;
  const system = entry.template.template.system === true;
  const moduleId = entry.template.moduleId;
  const templateId = entry.template.template.id;
  // Deployed from the editor, a copy is rewritten in canonical form, and a jar built on
  // Windows ships it in CRLF: unchanged in substance, it is still the module's version.
  const shipped = templates.shipped(moduleId, templateId)?.[path];
  const published = templates.published[path];
  const formattedOnly =
    (entry.file.status === "modified" || entry.file.updateAvailable) &&
    shipped !== undefined &&
    published !== undefined &&
    sameAsShipped(project, path, published, shipped);
  const tone = formattedOnly
    ? "identical"
    : entry.file.updateAvailable
      ? "update"
      : entry.file.status === "modified"
        ? "modified"
        : "identical";
  const { serverId } = templates;
  // A system file is reset; a copy takes the module's version, the one it announces.
  const reset =
    tone !== "identical" && serverId
      ? () => {
          if (!window.confirm(t("projectPanel.systemResetConfirm"))) return;
          void resetIntoDraft(project.id, serverId, moduleId, templateId, path, t);
        }
      : undefined;
  return { tone, module: moduleId, system, ...(reset ? { reset } : {}) };
}

/**
 * Puts a template file back as its module ships it, in the draft: the canvas shows it at
 * once, Deploy publishes it, Discard cancels it, like any edit.
 */
async function resetIntoDraft(
  projectId: string,
  serverId: string,
  moduleId: string,
  templateId: string,
  path: string,
  t: TFunction,
) {
  const store = useProjectTemplatesStore.getState();
  await store.loadShipped(serverId, moduleId, templateId);
  const content =
    useProjectTemplatesStore.getState().shipped[shippedKey(serverId, moduleId, templateId)]?.[path];
  const { openProjects, replaceProject } = useProjectsStore.getState();
  const current = openProjects.projects.find((p) => p.id === projectId);
  if (content === undefined || !current) {
    toast.error(t("moduleTemplates.errors.fetch_error"));
    return;
  }
  replaceProject(adoptDiskIntoProject(current, { [path]: content }, []));
  toast.success(t("projectPanel.systemResetDone"));
}

/** What a copy's tag says in a word: nothing when it is the module's version as is. */
/** A template copy that drifted gets an asterisk; its colour says which way. */
const ORIGIN_MARK: Record<TemplateOrigin["tone"], string | null> = {
  update: "text-[var(--warning)]",
  modified: "text-[var(--brand)]",
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
  fixed = false,
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
  /** A collection's Document: it stays where its module reads it, no drag, no "Move to". */
  fixed?: boolean;
}) {
  const { t } = useTranslation();
  const key = docKey(kind, item.id);
  const active = activeId === key;
  // A module's system element never leaves its place: no drag.
  const draggable = projectId !== null && !origin?.system && !fixed;
  const handle = useDraggable({ id: key, disabled: !draggable });
  // The dragged row stays in the tree as the gap it will fill.
  const placeholder = useDocumentDrag().key === key;
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
      ref={handle.setNodeRef}
      {...(draggable ? handle.listeners : {})}
      data-draggable={draggable || undefined}
      className={`group flex items-center gap-0.5 rounded-[10px] ${active ? "" : "hover:bg-[var(--surface-hover)]"} ${
        placeholder ? "opacity-40 outline-dashed outline-1 outline-[var(--border-strong)]" : ""
      }`}
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
        {origin && ORIGIN_MARK[origin.tone] ? (
          // Above: on the right it covered the row's ⋯, which shows on hover there.
          <Tooltip content={originLabel} side="top">
            <span
              role="img"
              aria-label={originLabel}
              className={`shrink-0 translate-y-[3px] text-[15px] font-semibold leading-none ${ORIGIN_MARK[origin.tone]}`}
            >
              <span aria-hidden>*</span>
            </span>
          </Tooltip>
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
          fixed={fixed}
          onReset={origin?.reset}
          module={origin?.module}
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
  fixed,
  onReset,
  module,
}: {
  projectId: ProjectId;
  project: Project;
  item: ProjectDocumentItem;
  onOpen: () => void;
  /** A module's system element: kept where the module put it, never deleted. */
  system: boolean;
  /** A collection's Document: never filed in a folder. */
  fixed: boolean;
  onReset?: () => void;
  /** The module a template copy comes from. */
  module?: string;
}) {
  const { t } = useTranslation();
  const targets =
    system || fixed ? [] : ["", ...listFolders(project)].filter((f) => f !== item.folder);
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
          <>
            {onReset && module && (
              <DropdownMenuItem title={t("projectPanel.systemResetHint")} onClick={onReset}>
                {t("projectPanel.takeModuleVersion", { module })}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() =>
                useProjectsStore
                  .getState()
                  .deleteFromProject({ projectId, nodeIds: [docKey(item.type, item.id)] })
              }
            >
              {t("projectPanel.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
