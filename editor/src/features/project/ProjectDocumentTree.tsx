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
import { DEFAULT_GROUP_COLOR, folderGroups } from "@/domain/canvasGroups";
import { MAX_FOLDER_DEPTH } from "@/domain/documentLayout";
import { type DocKey, docKey, documentCount } from "@/domain/documents";
import { childFolders, folderName, listFolders } from "@/domain/folders";
import type { Project, ProjectId } from "@/domain/types";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { NewDialogDialog } from "@/features/canvas/NewDialogDialog";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { ModuleTemplatesDialog } from "@/features/templates/ModuleTemplatesDialog";
import { sameAsShipped } from "@/features/templates/sameAsShipped";
import {
  type ProjectTemplates,
  useProjectTemplates,
} from "@/features/templates/useProjectTemplates";
import { collectionLabel, isCollectionKind, projectCollections } from "@/lib/documentCollections";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { contributionLabel, kindCreatableIn } from "@/lib/moduleDocumentKinds";
import { collectionDestination } from "@/lib/projectNavigation";
import { shippedKey, useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { isKindSyncedOn, useServerDocumentKindsStore } from "@/state/serverDocumentKindsStore";
import { useUiStore } from "@/state/uiStore";
import {
  type DocumentKindContribution,
  documentKindContribution,
  listDocumentKindContributions,
} from "@artisan/editor-sdk";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Plus,
  Puzzle,
  Settings,
} from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { documentRelPath } from "./DocumentYamlView";
import { FolderNameDialog } from "./FolderNameDialog";
import { type DocumentLinks, documentLinks } from "./documentLinks";
import { openProjectSettings } from "./projectSettings";
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
  const templates = useProjectTemplates(projectId);
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
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
  const allGroups = buildProjectDocuments(project, activeLang);
  // A collection's Documents are listed under its own entry, never at the root or in a folder.
  const groups = allGroups.filter((g) => !isCollectionKind(g.type));
  const collections = projectCollections(project);
  const originOf = (id: string) =>
    templateOrigin(templates, project, documentRelPath(project, id), t);
  // The Document whose links are marked: the one open in the view, else the one
  // Document selected on the board.
  const boardPick = useSelectionStore((s) =>
    s.menuId === null && s.ids.size === 1 ? [...s.ids][0] : undefined,
  );
  const relationOf = linkRelation(documentLinks(project), (activeId ?? boardPick) as DocKey);
  // Dropped outside every folder: back to the module's root.
  const rootDrop = useFolderDrop(editable ? project.id : null, "");
  return (
    <div
      {...rootDrop.props}
      className={`flex flex-col gap-0.5 rounded-[10px] ${rootDrop.over ? DROP_RING : ""}`}
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
          relationOf={relationOf}
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
          relationOf={relationOf}
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
                    relation={relationOf(docKey(g.type, it.id))}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

type Relation = "parent" | "child";

/** How a Document relates to `focus`: it opens it (parent), or `focus` opens it (child). */
function linkRelation(links: DocumentLinks, focus: DocKey | undefined) {
  return (key: DocKey): Relation | undefined => {
    if (!focus || key === focus) return undefined;
    if (links.parents.get(focus)?.has(key)) return "parent";
    if (links.children.get(focus)?.has(key)) return "child";
    return undefined;
  };
}

/** The drag payload of a sidebar row: the Document's `docKey`. */
const DOC_MIME = "application/x-artisan-document";
const DROP_RING = "outline outline-1 outline-[var(--brand)] bg-[var(--brand-soft)]";

/**
 * Where a dragged Document lands: `folder` (`""` = the module's root). `projectId`
 * `null` = read-only, no drop. The innermost target wins: a folder stops the drop
 * from reaching the folders around it.
 */
function useFolderDrop(projectId: ProjectId | null, folder: string, onEnter?: () => void) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child crossed: count them.
  const depth = useRef(0);
  const carries = (e: DragEvent) => projectId !== null && e.dataTransfer.types.includes(DOC_MIME);
  const leave = () => {
    depth.current = 0;
    setOver(false);
  };
  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (!carries(e)) return;
        e.stopPropagation();
        depth.current += 1;
        if (!over) onEnter?.();
        setOver(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!carries(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
      },
      onDragLeave: (e: DragEvent) => {
        if (!carries(e)) return;
        e.stopPropagation();
        depth.current -= 1;
        if (depth.current <= 0) leave();
      },
      onDrop: (e: DragEvent) => {
        if (!carries(e) || projectId === null) return;
        e.preventDefault();
        e.stopPropagation();
        leave();
        const key = e.dataTransfer.getData(DOC_MIME);
        if (key) useProjectsStore.getState().moveToFolder({ projectId, nodeIds: [key], folder });
      },
    },
  };
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
  relationOf,
}: {
  project: Project;
  contribution: DocumentKindContribution;
  items: ProjectDocumentItem[];
  /** Its argument: the Document's key (`docKey`). */
  onOpen: (documentId: string) => void;
  editable: boolean;
  originOf: OriginOf;
  activeId?: string;
  relationOf: (key: DocKey) => Relation | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverId, collectionKind } = useParams({ strict: false }) as {
    serverId?: string;
    collectionKind?: string;
  };
  const uiLang = useUiStore((s) => s.editorLang);
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const kind = contribution.kind;
  const label = collectionLabel(contribution, kind, uiLang);
  const look = kindAppearance(kind);
  const Chevron = open ? ChevronDown : ChevronRight;
  const active = collectionKind === kind;
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
                relation={relationOf(docKey(kind, it.id))}
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
  relationOf,
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
  relationOf: (key: DocKey) => Relation | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  // A folded folder opens when a Document is dragged over it.
  const drop = useFolderDrop(editable ? project.id : null, path, () => setOpen(true));
  const [dialog, setDialog] = useState<"sub" | "rename" | null>(null);
  const items = groups.flatMap((g) => g.items.filter((it) => it.folder === path));
  const Chevron = open ? ChevronDown : ChevronRight;
  const Icon = open ? FolderOpen : Folder;
  const color = frameColor(project, path);
  return (
    <div {...drop.props} className={`flex flex-col rounded-[10px] ${drop.over ? DROP_RING : ""}`}>
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
              relationOf={relationOf}
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
                  relation={relationOf(docKey(it.type, it.id))}
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
  /** Puts the module's version back into the draft; absent when it already is. */
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
  // Deployed from the editor, a system file is rewritten in canonical form: unchanged in
  // substance, it is still the module's version.
  const shipped = templates.shipped(moduleId, templateId)?.[path];
  const published = templates.published[path];
  const formattedOnly =
    system &&
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
  const reset =
    system && tone !== "identical" && serverId
      ? () => {
          if (!window.confirm(t("projectPanel.systemResetConfirm"))) return;
          void resetIntoDraft(project.id, serverId, moduleId, templateId, path, t);
        }
      : undefined;
  return { tone, module: moduleId, system, ...(reset ? { reset } : {}) };
}

/**
 * Puts a system file back as its module ships it, in the draft: the canvas shows it at
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
  relation,
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
  /** Set when this Document opens the focused one (parent) or is opened by it (child). */
  relation?: Relation;
  /** A collection's Document: it stays where its module reads it, no drag, no "Move to". */
  fixed?: boolean;
}) {
  const { t } = useTranslation();
  const key = docKey(kind, item.id);
  const active = activeId === key;
  // A module's system element never leaves its place: no drag.
  const draggable = projectId !== null && !origin?.system && !fixed;
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
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData(DOC_MIME, key);
              e.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
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
        {relation && <RelationMark relation={relation} />}
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
          fixed={fixed}
          onReset={origin?.reset}
        />
      )}
    </div>
  );
}

/** The arrow on a Document linked to the focused one: ← it opens it, → it is opened by it. */
function RelationMark({ relation }: { relation: Relation }) {
  const { t } = useTranslation();
  const label = t(`projectPanel.relation.${relation}`);
  const Arrow = relation === "parent" ? ArrowLeft : ArrowRight;
  return (
    <span role="img" aria-label={label} title={label} className="flex shrink-0">
      <Arrow className="size-3 text-[var(--brand)]" aria-hidden />
    </span>
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
