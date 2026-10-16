import { ArtisanWordmark } from "@/components/ArtisanWordmark";
import { projectNamespace } from "@/domain/docRef";
import type { Project } from "@/domain/types";
import {
  DocumentGroups,
  ProjectActions,
  ProjectDocumentTree,
} from "@/features/project/ProjectDocumentTree";
import { goToDocument } from "@/features/project/goToDocument";
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
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** Restrict translation to the vertical axis so the workspace card can't be dragged sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
import { documentCount } from "@/domain/documents";
import type { ProjectId } from "@/domain/types";
import { buildProjectGroups, diskProjectsToSummaries } from "@/features/projects/projectGroups";
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
import { ChevronDown, ChevronRight, Folder, FolderOpen, GripVertical } from "lucide-react";
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
    const renamed = () => setRefetchToken((token) => token + 1);
    window.addEventListener("ifz:project_renamed", renamed);
    return () => window.removeEventListener("ifz:project_renamed", renamed);
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
  // disk" signal (Project created, renamed elsewhere).
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies = refresh signals
  useEffect(() => {
    let cancelled = false;
    setProjectsStatus("loading");
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
  // Add-on-owned projects surface under "Installed modules", not the flat list
  // (ADR addon-owned-project-roots) — same grouping as a server page, computed
  // once in `buildProjectGroups`.
  const { flatProjects, moduleGroups } = buildProjectGroups({
    projects: finalList,
    screens: serverScreens,
    mountedModuleIds,
    localProjects,
  });

  // Document count per Project: only the ones actually opened (live count, it
  // follows edits). Recomputing it for every Project would cost a disk read
  // each just to fill a sidebar, so a Project never opened shows no badge.
  const liveCount = new Map(localProjects.map((p) => [p.id, documentCount(p)]));
  const countFor = (p: ProjectSummary): number | null => liveCount.get(p.id as ProjectId) ?? null;

  // Does the open project have a row in the list? Otherwise (demo, unlisted
  // project), it is shown at the top with its Documents.
  const openProjectId = urlParams.projectId;
  const visibleRows = [...flatProjects, ...moduleGroups.flatMap((g) => g.projects)];
  const openIsListed =
    !!openProjectId &&
    visibleRows.some((p) => p.id === openProjectId || projectUrlId(p) === openProjectId);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = flatProjects.map((p) => p.id);
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
        <div className="flex flex-col">
          <div className="px-2 pt-0.5 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.myProjects")}
          </div>
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
              items={flatProjects.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col">
                {flatProjects.map((w) => (
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
                  {t("sidebar.newProject")}
                </button>
              }
            />
          )}
        </div>

        <div className="mt-4 flex flex-col">
          <div className="px-2 pt-0.5 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.installedModules")}
          </div>
          {moduleGroups.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] text-[var(--text-faint)]">
              {t("sidebar.noModules")}
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {moduleGroups.map((g) =>
                g.collapsed ? (
                  // One project, no screen (boutique) → a SINGLE entry named
                  // after the module that opens the editor directly.
                  <OwnedProjectItem
                    key={g.id}
                    id={g.projects[0]!.id}
                    urlId={projectUrlId(g.projects[0]!)}
                    name={g.label}
                    count={countFor(g.projects[0]!)}
                    serverId={urlServerId(allServerEntries, g.projects[0]!.serverKeyId) || srvParam}
                  />
                ) : (
                  <li key={g.id} className="flex flex-col">
                    {/* TODO: render the module's icon once modules ship real icons */}
                    <div className="px-2.5 pt-0.5 pb-1 text-[12px] font-semibold text-[var(--text)]">
                      {g.label}
                    </div>
                    <ul className="ml-3 flex flex-col border-l border-[var(--border)] pl-1">
                      {g.projects.map((w) => (
                        <OwnedProjectItem
                          key={w.id}
                          id={w.id}
                          urlId={projectUrlId(w)}
                          // Under a module group the canvas entry is "Editor"
                          // (ADR module-config-screens §2) — the group header
                          // already carries the module's name. Only a module
                          // owning several projects needs their real names.
                          name={g.projects.length === 1 ? t("screens.editorEntry") : w.name}
                          count={countFor(w)}
                          serverId={urlServerId(allServerEntries, w.serverKeyId) || srvParam}
                        />
                      ))}
                      {g.screens.map((s) => (
                        <ScreenItem key={s.id} screen={s} serverId={srvParam} />
                      ))}
                      {g.hasScreen && (
                        <li>
                          <Link
                            to="/m/$moduleId"
                            params={{ moduleId: g.id }}
                            onClick={() => useSidebarStore.getState().close()}
                            className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                          >
                            <span className="truncate flex-1">{t("sidebar.configuration")}</span>
                          </Link>
                        </li>
                      )}
                    </ul>
                  </li>
                ),
              )}
            </ul>
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

/** Module Config screen link under "Installed modules" (ADR module-config-screens). */
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
        className={
          isActive
            ? "flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-semibold text-white transition-colors"
            : "flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        }
      >
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
  const project = useProjectsStore((s) =>
    s.openProjects.projects.find((p) => p.id === id || (!!urlId && projectUrlId(p) === urlId)),
  );
  if (!project) return null;
  return (
    <div data-tour="elements" className="ml-3 border-l border-[var(--border)] pl-1">
      <ProjectDocumentTree
        projectId={project.id}
        header="none"
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

/** Add-on-owned project link under "Installed modules" — like a project item but
 *  not reorderable (its placement is the module's, not the user's). */
function OwnedProjectItem({
  id,
  urlId,
  name,
  count,
  serverId,
}: {
  id: string;
  /** Exact folder/module ID in this location. */
  urlId?: string;
  name: string;
  count: number | null;
  serverId: string | null;
}) {
  const { t } = useTranslation();
  const params = useParams({ strict: false }) as { projectId?: string };
  const isActiveProject = params.projectId === id || (!!urlId && params.projectId === urlId);
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <ProjectLink
          projectId={urlId ?? id}
          serverId={serverId}
          className={
            isActiveProject
              ? "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-semibold text-white transition-colors [&_svg]:text-[var(--brand)]"
              : "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
          }
        >
          <span className="min-w-0 truncate" title={name}>
            {name}
          </span>
          {count != null && (
            <span
              title={t("serverDetail.documentCount", { count })}
              aria-label={t("serverDetail.documentCount", { count })}
              className="shrink-0 rounded-full bg-[var(--surface-raised)] px-1.5 text-[10px] font-medium tabular-nums text-[var(--text-faint)]"
            >
              {count}
            </span>
          )}
        </ProjectLink>
        {isActiveProject && <ActiveProjectActions id={id} urlId={urlId} />}
      </div>
      {isActiveProject && <ActiveProjectDocuments id={id} urlId={urlId} serverId={serverId} />}
    </li>
  );
}

function SortableProjectItem({
  id,
  urlId,
  name,
  count,
  serverId,
}: {
  id: string;
  /** Exact folder/module ID in this location. */
  urlId?: string;
  name: string;
  count: number | null;
  serverId: string | null;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const params = useParams({ strict: false }) as { projectId?: string };
  const isActiveProject = params.projectId === id || (!!urlId && params.projectId === urlId);
  const indexed = useIndexedProject(urlId, id);
  const [expanded, setExpanded] = useState(false);
  const canExpand = !isActiveProject && !!indexed;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <li ref={setNodeRef} style={style} className="flex flex-col">
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
              ? "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-semibold text-white transition-colors [&_svg]:text-[var(--brand)]"
              : "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
          }
        >
          {isActiveProject ? (
            <FolderOpen className="size-[15px] shrink-0" />
          ) : (
            <Folder className="size-[15px] shrink-0 text-[var(--text-faint)]" />
          )}
          <span className="min-w-0 truncate">{name}</span>
          {count != null && (
            <span
              title={t("serverDetail.documentCount", { count })}
              aria-label={t("serverDetail.documentCount", { count })}
              className="shrink-0 rounded-full bg-[var(--surface-raised)] px-1.5 text-[10px] font-medium tabular-nums text-[var(--text-faint)]"
            >
              {count}
            </span>
          )}
        </ProjectLink>
        {isActiveProject && <ActiveProjectActions id={id} urlId={urlId} />}
        <button
          type="button"
          aria-label="Reorder project"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="flex h-auto w-6 shrink-0 cursor-grab items-center justify-center rounded text-[var(--text-faint)] transition-opacity hover:text-[var(--text-mut)] active:cursor-grabbing lg:pointer-events-none lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100"
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>
      {isActiveProject && !collapsed && (
        <ActiveProjectDocuments id={id} urlId={urlId} serverId={serverId} />
      )}
      {canExpand && expanded && <OtherProjectDocuments project={indexed} serverId={serverId} />}
    </li>
  );
}
