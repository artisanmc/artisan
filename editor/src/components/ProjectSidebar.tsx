import { ArtisanWordmark } from "@/components/ArtisanWordmark";
import { IconTile } from "@/components/ui/icon-tile";
import { projectNamespace } from "@/domain/docRef";
import type { Project } from "@/domain/types";
import {
  DocumentGroups,
  ProjectActions,
  ProjectDocumentTree,
} from "@/features/project/ProjectDocumentTree";
import { goToDocument } from "@/features/project/goToDocument";
import { PROJECTS_RELOADED_EVENT } from "@/features/project/onProjectsReloaded";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { projectDestination } from "@/lib/projectNavigation";
import { projectUrlId } from "@/lib/projectUrlId";
import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Restrict translation to the vertical axis so the workspace card can't be dragged sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
import { docKey, documentCount, resolveDocKey } from "@/domain/documents";
import type { ProjectId } from "@/domain/types";
import {
  type ModuleGroupEntry,
  type PluginModule,
  buildModuleList,
  diskProjectsToSummaries,
} from "@/features/projects/projectGroups";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { listServerProjects } from "@/lib/api/projectFiles";
import type { ProjectSummary, ServerSummary } from "@/lib/api/servers";
import { displayServerLabel } from "@/lib/serverLabel";
import { urlServerId } from "@/lib/urlIds";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useServersStore } from "@/state/serversStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  GripVertical,
  Settings,
  Table2,
  type Terminal,
} from "lucide-react";
import { NewProjectDialog } from "./NewProjectDialog";
import { type ServerEntry, ServerSelector } from "./ServerSelector";
import { UserMenu } from "./UserMenu";
import { useServersStatus } from "./useServersStatus";

export function ProjectSidebar() {
  const { t } = useTranslation();
  const localProjects = useProjectsStore((s) => s.openProjects.projects);
  const projectOrder = useProjectsStore((s) => s.openProjects.projectOrder);
  const reorderProjects = useProjectsStore((s) => s.reorderProjects);
  const mountedModuleIds = useModulesStore((s) => s.mountedIds);
  const serverScreens = useServerScreensStore((s) => s.screens);
  const indexedProjects = useServerIndexStore((s) => s.projects);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [serverProjects, setServerProjects] = useState<ProjectSummary[]>([]);
  // Three states, like a server page: reading, read, could not read. An empty
  // list asserted while reading reads as a server without Projects, and the
  // create button then invites writing to a disk that cannot be reached.
  const [projectsStatus, setProjectsStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [updateRequired, setUpdateRequired] = useState(false);
  // The hub's servers with their live state, re-read every 15 s: a server that
  // connected since loading shows up at once.
  const { data: serversStatus } = useServersStatus();
  const allServerEntries = useMemo(() => serverEntriesOf(serversStatus ?? []), [serversStatus]);
  // Share the ids so every surface can build links the same way.
  useEffect(() => {
    useServersStore.getState().setServers(allServerEntries);
  }, [allServerEntries]);
  const [refetchToken, setRefetchToken] = useState(0);
  useEffect(() => {
    const reread = () => setRefetchToken((token) => token + 1);
    window.addEventListener("ifz:project_renamed", reread);
    // A reload can add or drop folders: an add-on registers its own after the server started.
    window.addEventListener(PROJECTS_RELOADED_EVENT, reread);
    return () => {
      window.removeEventListener("ifz:project_renamed", reread);
      window.removeEventListener(PROJECTS_RELOADED_EVENT, reread);
    };
  }, []);

  // Active server: URL param first, then persisted selection. Routes without params (settings, credits…) fall back to the
  // persisted selection so navigating there doesn't silently "deselect" the
  // server while the project list stays scoped to it.
  const storedServerId = useServersStore((s) => s.activeServerId);
  const urlParams = useParams({ strict: false }) as {
    serverId?: string;
    projectId?: string;
  };
  // Only trust the persisted server if the hub still lists it — a deleted
  // server must not filter the project list down to nothing.
  const storedServerValid =
    storedServerId != null && allServerEntries.some((e) => e.serverId === storedServerId);
  const rawServerParam =
    urlParams.serverId ?? (urlParams.projectId ? null : storedServerValid ? storedServerId : null);
  const activeServerId = rawServerParam
    ? (allServerEntries.find(
        (e) => e.serverId === rawServerParam || e.serverSlug === rawServerParam,
      )?.serverId ?? rawServerParam)
    : null;

  // URL-facing form: links carry slugs, everything else stays id-based.
  const srvParam = urlServerId(allServerEntries, activeServerId);

  // Persist the URL-driven selection so param-less routes keep it. Only store
  // resolved ids (never raw slugs) — the entry lookup guarantees that.
  useEffect(() => {
    if (urlParams.serverId) {
      const resolved = allServerEntries.find(
        (e) => e.serverId === urlParams.serverId || e.serverSlug === urlParams.serverId,
      )?.serverId;
      if (resolved && useServersStore.getState().activeServerId !== resolved) {
        useServersStore.getState().setActiveServerId(resolved);
      }
    }
  }, [urlParams.serverId, allServerEntries]);

  /**
   * The active server's Projects, read from ITS disk on every refresh.
   *
   * The hub keeps no list of them: it went stale at the first renamed or
   * deleted folder (ADR `server-disk-only-storage`). The folder name IS the
   * identity — renaming it renames it in the editor, with no reconciliation.
   * Offline server → say so (`projectsStatus`): its Projects cannot be opened,
   * and there is no point inviting to create another one.
   */
  // `refetchToken` is not read in the effect: it is precisely the "re-read the
  // disk" signal (Project created, renamed elsewhere, server reloaded).
  const listedServer = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies = refresh signals
  useEffect(() => {
    let cancelled = false;
    // A re-read of the same server keeps its list on screen until the answer arrives.
    if (listedServer.current !== activeServerId) setProjectsStatus("loading");
    listedServer.current = activeServerId;
    if (!activeServerId) {
      // Every Project belongs to a server (ADR `server-only-projects`).
      setServerProjects([]);
      setProjectsStatus("ready");
      return;
    }
    listServerProjects(activeServerId).then((res) => {
      if (cancelled) return;
      setServerProjects(
        res.ok ? diskProjectsToSummaries(activeServerId, res.projectIds, res.projects) : [],
      );
      setProjectsStatus(res.ok ? "ready" : "unavailable");
      setUpdateRequired(!res.ok && res.error === "plugin_update_required");
    });
    return () => {
      cancelled = true;
    };
  }, [activeServerId, refetchToken]);

  const serverIds = new Set(serverProjects.map((p) => p.id));
  const optimisticEntries: ProjectSummary[] = localProjects
    .filter((p) => !serverIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      hash: "",
      updatedAt: p.updatedAt,
      serverKeyId: (p as unknown as { serverKeyId?: string }).serverKeyId ?? "",
    }));
  const allProjects = [...serverProjects, ...optimisticEntries];

  const filteredServerProjects = activeServerId
    ? allProjects.filter((p) => p.serverKeyId === activeServerId)
    : allProjects;

  const idToProject = new Map(filteredServerProjects.map((p) => [p.id, p]));
  const ordered: ProjectSummary[] = [];
  for (const id of projectOrder) {
    const p = idToProject.get(id);
    if (p) {
      ordered.push(p);
      idToProject.delete(id);
    }
  }
  const remaining = [...idToProject.values()].sort((a, b) => a.id.localeCompare(b.id));
  const finalList = [...ordered, ...remaining];
  // One folder = one module: the plugins' modules with their folders and screens,
  // then the admin's own — same split as a server page, computed once in `buildModuleList`.
  const { pluginModules, contentModules: projectRows } = buildModuleList({
    projects: finalList,
    screens: serverScreens,
    mountedModuleIds,
    localProjects,
  });

  // Document count per Project: live for the ones opened (it follows edits), else
  // their published state from the server index, already read in the background to
  // expand them. Before the index is in, a Project never opened shows no badge.
  const countOf = (p: Project) => documentCount(p);
  const liveCount = new Map(localProjects.map((p) => [p.id as string, countOf(p)]));
  // Ids carry their server: another server's index matches none of these rows.
  const indexedCount = new Map(indexedProjects.map((p) => [p.id as string, countOf(p)]));
  const countFor = (p: ProjectSummary): number | null =>
    liveCount.get(p.id) ?? indexedCount.get(p.id) ?? null;

  // Does the open project have a row in the list? Otherwise (demo, unlisted
  // project), it is shown at the top with its Documents.
  const openProjectId = urlParams.projectId;
  const visibleRows = [...pluginModules.flatMap((m) => m.projects), ...projectRows];
  const openIsListed =
    !!openProjectId &&
    visibleRows.some((p) => p.id === openProjectId || projectUrlId(p) === openProjectId);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = projectRows.map((p) => p.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderProjects(arrayMove(ids, oldIndex, newIndex) as ProjectId[]);
  };

  return (
    <nav className="flex h-full flex-col gap-3.5 px-3 py-2">
      <Link
        to="/"
        onClick={() => useSidebarStore.getState().close()}
        className="flex h-12 shrink-0 items-center gap-1 rounded-[10px] px-1.5 transition-colors hover:bg-[var(--surface-hover)]"
      >
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="size-7 shrink-0"
        />
        <ArtisanWordmark />
      </Link>

      <ServerSelector servers={allServerEntries} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {openProjectId && !openIsListed && (
          <UnlistedOpenProject urlId={openProjectId} serverId={srvParam} />
        )}
        {pluginModules.length > 0 && (
          <div className="flex flex-col">
            <div className="section-label px-2 pt-0.5 pb-2">{t("sidebar.installedModules")}</div>
            <ul className="flex flex-col">
              {pluginModules.map((m) => (
                <PluginModuleItem
                  key={m.id}
                  module={m}
                  countFor={countFor}
                  serverId={srvParam}
                  serverIdOf={(p) => urlServerId(allServerEntries, p.serverKeyId) || srvParam}
                />
              ))}
            </ul>
          </div>
        )}
        <div className={pluginModules.length > 0 ? "mt-4 flex flex-col" : "flex flex-col"}>
          <div className="section-label px-2 pt-0.5 pb-2">{t("sidebar.myModules")}</div>
          {projectsStatus !== "ready" && (
            <div className="px-2.5 pb-1 text-[11.5px] text-[var(--text-faint)]">
              {projectsStatus === "loading"
                ? t("sidebar.loadingProjects")
                : updateRequired
                  ? t("linkedServers.updateRequired")
                  : t("sidebar.projectsUnavailable")}
            </div>
          )}
          <DndContext sensors={sensors} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis]}>
            <SortableContext
              items={projectRows.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col">
                {projectRows.map((w) => (
                  <SortableProjectItem
                    key={w.id}
                    id={w.id}
                    urlId={projectUrlId(w)}
                    name={w.name}
                    count={countFor(w)}
                    serverId={urlServerId(allServerEntries, w.serverKeyId) || srvParam}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {projectsStatus === "ready" && (
            <NewProjectDialog
              serverKeyId={activeServerId}
              onCreated={() => setRefetchToken((n) => n + 1)}
              trigger={
                <button
                  type="button"
                  className="mt-1 block w-full cursor-pointer rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  {t("sidebar.newModule")}
                </button>
              }
            />
          )}
        </div>
      </div>

      <UserMenu
        serverLabel={allServerEntries.find((e) => e.serverId === activeServerId)?.serverLabel}
      />
    </nav>
  );
}

/** The selector's rows, straight from what the hub lists. */
export function serverEntriesOf(servers: ServerSummary[]): ServerEntry[] {
  return servers.map((s) => ({
    serverId: s.id,
    serverLabel: displayServerLabel(s),
    online: s.online,
    updateRequired: s.updateRequired === true,
  }));
}

/**
 * The link to a Project, with the only decision that varies: server context
 * or not. Both branches are written out so the router types them —
 * a computed `to`/`params` required two `as any`, hiding route errors.
 */
function ProjectLink({
  projectId,
  serverId,
  className,
  children,
}: {
  projectId: string;
  serverId: string | null;
  className: string;
  children: ReactNode;
}) {
  const close = () => useSidebarStore.getState().close();
  return (
    <Link
      {...projectDestination(projectId, serverId ?? undefined)}
      onClick={close}
      className={className}
    >
      {children}
    </Link>
  );
}

/** A plugin module's Config screen link (ADR module-config-screens). */
function ScreenItem({
  screen,
  serverId,
}: {
  screen: ServerEditorScreen;
  serverId: string | null;
}) {
  const params = useParams({ strict: false }) as { screenId?: string };
  const isActive = params.screenId === screen.id;
  if (!serverId) return null;
  return (
    <li>
      <Link
        to="/servers/$serverId/screens/$screenId"
        params={{ serverId, screenId: screen.id }}
        onClick={() => useSidebarStore.getState().close()}
        className={entryRowClass(isActive)}
      >
        <EntryTile icon={Table2} />
        <span className="truncate flex-1" title={screen.label}>
          {screen.label}
        </span>
      </Link>
    </li>
  );
}

/**
 * The open project's Documents, under its row. Only shown once the project is
 * loaded in the projects store, so never for a project that is merely listed.
 */
function ActiveProjectDocuments({
  id,
  urlId,
  serverId,
}: {
  id: string;
  urlId?: string;
  serverId: string | null;
}) {
  const navigate = useNavigate();
  const { documentId } = useParams({ strict: false }) as { documentId?: string };
  const { kind } = useSearch({ strict: false }) as { kind?: string };
  const project = useProjectsStore((s) =>
    s.openProjects.projects.find((p) => p.id === id || (!!urlId && projectUrlId(p) === urlId)),
  );
  if (!project) return null;
  return (
    <div data-tour="elements" className="px-1.5 pt-0.5">
      <ProjectDocumentTree
        projectId={project.id}
        header="none"
        activeId={
          documentId && (kind ? docKey(kind, documentId) : resolveDocKey(project, documentId))
        }
        onOpen={(documentId) => {
          useSidebarStore.getState().close();
          goToDocument(navigate, { serverId, project, ref: documentId });
        }}
      />
    </div>
  );
}

/**
 * The open project when no row of the list holds it: the demo (no server) or
 * a project the server's list does not show. Without this block its Documents
 * would have nowhere to go.
 */
function UnlistedOpenProject({
  urlId,
  serverId,
}: {
  urlId: string;
  serverId: string | null;
}) {
  const project = useProjectsStore((s) =>
    s.openProjects.projects.find((p) => p.id === urlId || projectUrlId(p) === urlId),
  );
  if (!project) return null;
  return (
    <div className="mb-3 flex flex-col">
      <div className="flex items-center gap-1 rounded-[10px] px-2.5 py-0.5">
        <FolderOpen className="size-[15px] shrink-0 text-[var(--brand)]" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
          {project.name}
        </span>
        <ProjectActions projectId={project.id} />
      </div>
      <ActiveProjectDocuments id={project.id} urlId={urlId} serverId={serverId} />
    </div>
  );
}

/** Settings and creation, on the open project's row — once loaded. */
function ActiveProjectActions({ id, urlId }: { id: string; urlId?: string }) {
  const project = useProjectsStore((s) =>
    s.openProjects.projects.find((p) => p.id === id || (!!urlId && projectUrlId(p) === urlId)),
  );
  return project ? <ProjectActions projectId={project.id} /> : null;
}

/**
 * A server project that is not open, seen through the server index (published
 * state): its Documents read-only, expandable on demand. A click opens the
 * Document in its project. Nothing is rendered until the index knows it.
 */
function useIndexedProject(urlId: string | undefined, id: string): Project | undefined {
  return useServerIndexStore((s) =>
    s.projects.find((p) => projectNamespace(p) === (urlId ?? id) || p.id === id),
  );
}

function OtherProjectDocuments({
  project,
  serverId,
}: {
  project: Project;
  serverId: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a named group of navigation lists, not a form — <fieldset> would be wrong.
    <div
      role="group"
      aria-label={t("sidebar.projectDocuments", { name: project.name })}
      className="ml-3 flex flex-col border-l border-[var(--border)] pl-1"
    >
      <DocumentGroups
        project={project}
        onOpen={(documentId) => {
          useSidebarStore.getState().close();
          // Opens this project, centred on the Document (`?doc=`, cf. goToDocument).
          void navigate({
            ...projectDestination(projectNamespace(project), serverId ?? undefined),
            search: { doc: documentId },
          } as never);
        }}
      />
    </div>
  );
}

function ExpandToggle({
  name,
  expanded,
  onToggle,
}: {
  name: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={t("sidebar.showDocuments", { name })}
      onClick={onToggle}
      className="flex w-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] hover:text-[var(--text)]"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

interface ProjectItemProps {
  id: string;
  /** Exact folder/module ID in this location. */
  urlId?: string;
  name: string;
  count: number | null;
  serverId: string | null;
}

function SortableProjectItem(props: ProjectItemProps) {
  const sortable = useSortable({ id: props.id });
  return <ProjectItem {...props} sortable={sortable} />;
}

/**
 * A folder's row: a link that opens it, its Documents under it once open (or on
 * demand, from the published state). [sortable] adds the drag handle of the
 * admin's own list; [children] goes under the row (a plugin module's screens).
 */
function ProjectItem({
  id,
  urlId,
  name,
  count,
  serverId,
  sortable,
  children,
  defaultExpanded = false,
}: ProjectItemProps & {
  sortable?: ReturnType<typeof useSortable>;
  children?: ReactNode;
  /** Opens the row on mount: the page shown is one of its children. */
  defaultExpanded?: boolean;
}) {
  const style = sortable
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.5 : 1,
      }
    : undefined;
  const params = useParams({ strict: false }) as { projectId?: string };
  const isActiveProject = params.projectId === id || (!!urlId && params.projectId === urlId);
  const indexed = useIndexedProject(urlId, id);
  // A module's screens and commands fold with it: shown once the row is open, or when one of them is.
  const hasChildren = children != null && children !== false;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const canExpand = !isActiveProject && (!!indexed || hasChildren);
  const [collapsed, setCollapsed] = useState(false);
  const open = isActiveProject ? !collapsed : expanded;

  return (
    <li
      ref={sortable?.setNodeRef}
      style={style}
      className={
        // The open project stands out as one block: its row and its Documents.
        isActiveProject && !collapsed
          ? "my-1 flex flex-col rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface-raised)] pb-1.5"
          : "flex flex-col"
      }
    >
      <div className="group flex items-stretch gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        {isActiveProject ? (
          <ExpandToggle
            name={name}
            expanded={!collapsed}
            onToggle={() => setCollapsed((v) => !v)}
          />
        ) : (
          canExpand && (
            <ExpandToggle name={name} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
          )
        )}
        <ProjectLink
          projectId={urlId ?? id}
          serverId={serverId}
          className={
            isActiveProject
              ? "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-semibold text-[var(--text)] transition-colors [&_svg]:text-[var(--brand)]"
              : "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
          }
        >
          {isActiveProject ? (
            <FolderOpen className="size-[15px] shrink-0" />
          ) : (
            <Folder className="size-[15px] shrink-0 text-[var(--text-faint)]" />
          )}
          <span className="min-w-0 truncate">{name}</span>
          {/* Open, its tree lists the Documents: the count would only take the name's room. */}
          {count != null && !isActiveProject && <DocumentCount count={count} />}
        </ProjectLink>
        {isActiveProject && <ActiveProjectActions id={id} urlId={urlId} />}
        {sortable && (
          <button
            type="button"
            aria-label="Reorder project"
            ref={sortable.setActivatorNodeRef}
            {...sortable.attributes}
            {...sortable.listeners}
            className="flex h-auto w-6 shrink-0 cursor-grab items-center justify-center rounded text-[var(--text-faint)] transition-opacity hover:text-[var(--text-mut)] active:cursor-grabbing lg:pointer-events-none lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100"
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
      </div>
      {isActiveProject && !collapsed && (
        <ActiveProjectDocuments id={id} urlId={urlId} serverId={serverId} />
      )}
      {canExpand && expanded && indexed && (
        <OtherProjectDocuments project={indexed} serverId={serverId} />
      )}
      {open && children}
    </li>
  );
}

function DocumentCount({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <span
      title={t("serverDetail.documentCount", { count })}
      aria-label={t("serverDetail.documentCount", { count })}
      className="shrink-0 rounded-full bg-[var(--surface-raised)] px-1.5 text-[11px] font-medium tabular-nums text-[var(--text-faint)]"
    >
      {count}
    </span>
  );
}

/**
 * A plugin's module. With one folder, the row is that folder under the module's
 * name; otherwise the module's name heads its folders. Its screens follow.
 */
function PluginModuleItem({
  module,
  countFor,
  serverId,
  serverIdOf,
}: {
  module: PluginModule;
  countFor: (p: ProjectSummary) => number | null;
  serverId: string | null;
  serverIdOf: (p: ProjectSummary) => string | null;
}) {
  const params = useParams({ strict: false }) as { screenId?: string };
  // The page shown is one of the module's: it opens folded out, so the active row is visible.
  const showsChild = module.entries.some(
    (e) => e.kind === "screen" && e.screen.id === params.screenId,
  );
  const [expanded, setExpanded] = useState(showsChild);
  const entries = module.entries.length > 0 && (
    <ModuleEntries entries={module.entries} serverId={serverId} />
  );
  const [only] = module.projects;
  if (only && module.projects.length === 1) {
    return (
      <ProjectItem
        id={only.id}
        urlId={projectUrlId(only)}
        name={module.label}
        count={countFor(only)}
        serverId={serverIdOf(only)}
        defaultExpanded={showsChild}
      >
        {entries}
      </ProjectItem>
    );
  }
  return (
    <li className="flex flex-col">
      <div className="flex items-stretch gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <ExpandToggle
          name={module.label}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
        />
        {/* TODO: render the module's icon once modules ship real icons */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
        >
          <Folder className="size-[15px] shrink-0 text-[var(--text-faint)]" />
          <span className="min-w-0 truncate">{module.label}</span>
        </button>
      </div>
      {expanded && module.projects.length > 0 && (
        <ul className="ml-3 flex flex-col border-l border-[var(--border)] pl-1">
          {module.projects.map((p) => (
            <ProjectItem
              key={p.id}
              id={p.id}
              urlId={projectUrlId(p)}
              name={p.name}
              count={countFor(p)}
              serverId={serverIdOf(p)}
            />
          ))}
        </ul>
      )}
      {expanded && entries}
    </li>
  );
}

/**
 * What a plugin module alone manages: its screens and its configuration, one row each
 * with its tile, like the Documents of a folder (no header).
 */
function ModuleEntries({
  entries,
  serverId,
}: {
  entries: ModuleGroupEntry[];
  serverId: string | null;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col">
      {entries.map((e) =>
        e.kind === "screen" ? (
          <ScreenItem key={`s:${e.screen.id}`} screen={e.screen} serverId={serverId} />
        ) : (
          <li key={`c:${e.moduleId}`}>
            <Link
              to="/m/$moduleId"
              params={{ moduleId: e.moduleId }}
              onClick={() => useSidebarStore.getState().close()}
              className={entryRowClass(false)}
            >
              <EntryTile icon={Settings} />
              <span className="truncate flex-1">{t("sidebar.configuration")}</span>
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

/** A module entry's row: the frame and type of a Document's row in the tree. */
function entryRowClass(active: boolean): string {
  return `flex items-center gap-2 rounded-[10px] py-[5px] pr-2 pl-1.5 text-[13px] leading-5 text-[var(--text)] transition-colors ${
    active ? "bg-[var(--surface-hover)] font-semibold" : "hover:bg-[var(--surface-hover)]"
  }`;
}

/** A neutral tile for a module's screen or configuration. */
function EntryTile({ icon }: { icon: typeof Terminal }) {
  return (
    <span className="flex shrink-0" aria-hidden>
      <IconTile icon={icon} fg="var(--text-mut)" soft="var(--surface-raised-2)" size="xs" />
    </span>
  );
}
