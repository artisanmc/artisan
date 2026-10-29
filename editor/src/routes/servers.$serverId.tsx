import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
import { ImportProjectDialog } from "@/features/import/ImportProjectDialog";
import { type ProjectRenamed, onProjectRenamed } from "@/features/project/onProjectRenamed";
import {
  PROJECTS_RELOADED_EVENT,
  type ProjectsReloaded,
} from "@/features/project/onProjectsReloaded";
import { RenameProjectButton } from "@/features/projects/RenameProjectButton";
import { buildModuleList, diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { ServerTabs, serverTabOf } from "@/features/serverPage/ServerTabs";
import { ServerFrameContext, useServerFrame } from "@/features/serverPage/serverFrame";
import { EditorAddressBanner } from "@/features/settings/EditorAddressBanner";
import { listServerProjects } from "@/lib/api/projectFiles";
import { type ProjectSummary, type ServerSummary, listServers } from "@/lib/api/servers";
import { cx } from "@/lib/cx";
import { screenDestination } from "@/lib/projectNavigation";
import { projectUrlId } from "@/lib/projectUrlId";
import { displayServerLabel } from "@/lib/serverLabel";
import { useAuthStore } from "@/state/authStore";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useSidebarStore } from "@/state/sidebarStore";
import {
  Link,
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { ChevronRight, Folder, Puzzle } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId")({
  component: ServerDetailPage,
});

/**
 * The frame: who you are, which server, and its tabs (overview, board, data,
 * settings), each a route of its own under the same header. A project or a
 * screen of the server fills the screen without the frame.
 *
 * It subscribes to NO editing state — the board renders below it, and a parent
 * that re-renders re-renders the whole canvas. Everything live (disk read,
 * projects, modules) lives in the tabs, which only exist when displayed.
 */
export default function ServerDetailPage() {
  const { serverId } = useParams({
    from: "/servers/$serverId",
  });
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const authLoading = useAuthStore((s) => s.isLoading);
  const [summary, setSummary] = useState<ServerSummary | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const childMatches = useChildMatches();
  const navigationPinned = useSidebarStore((s) => s.pinned);

  // Anonymous visitor → bounce to login, preserving the current URL (incl.
  // deep-linked child routes) so they land back here after signing in.
  useEffect(() => {
    if (authLoading || currentUser) return;
    const next = window.location.pathname + window.location.search;
    navigate({ to: "/login", search: { next }, replace: true });
  }, [authLoading, currentUser, navigate]);

  useEffect(() => {
    if (!serverId) return;
    listServers()
      .then((servers) => {
        const sk = servers.find((k) => k.id === serverId);
        if (!sk) {
          // This server does not exist: the URL is stale. Go back to the server list —
          // the alternative would be waiting forever for a disk read that cannot be
          // addressed to anyone.
          navigate({ to: "/servers", replace: true });
          return;
        }
        setSummary(sk);
      })
      .catch((e: Error & { status?: number }) => {
        if (e?.status === 403) {
          setAccessDenied(true);
        } else if (e?.status === 404) {
          navigate({ to: "/servers", replace: true });
        } else console.error(e);
      });
  }, [serverId, navigate]);

  const frame = useMemo(
    () => ({ serverId, serverKeyId: summary?.id ?? null, summary }),
    [serverId, summary],
  );

  if (accessDenied)
    return (
      <div className="flex h-full items-center justify-center p-8 text-[var(--text-mut)]">
        {t("serverDetail.accessDenied")}
      </div>
    );
  const child = childMatches[0];
  const tab = serverTabOf(child?.routeId);
  // A project or a screen of the server: full screen, without the frame.
  if (child && !tab) return <Outlet />;

  return (
    <ServerFrameContext.Provider value={frame}>
      <div className="flex h-full min-h-0 flex-col">
        {/* One row, as tall as the sidebar's logo row, on the sidebar's surface; clear of the navigation toggle while the
            sidebar is not pinned, as the project top bar. */}
        <header
          className={cx(
            "flex shrink-0 flex-wrap items-stretch gap-x-6 bg-[var(--surface)] pr-6 pl-16 lg:h-16 lg:flex-nowrap lg:pl-24",
            navigationPinned && "lg:pl-6",
          )}
        >
          <div className="flex min-h-14 min-w-0 items-center gap-2.5">
            <h1 className="truncate text-[17px] font-semibold tracking-tight text-[var(--text)]">
              {summary ? displayServerLabel(summary) : serverId}
            </h1>
            {summary && <ServerStateBadge summary={summary} />}
          </div>
          <ServerTabs serverId={serverId} active={tab ?? "/servers/$serverId"} />
          {summary && <ServerVersions summary={summary} />}
        </header>
        {/* The concave top-left corner and hairline of the project page: the sidebar and this
            header read as one L-shaped frame around the tab's content. */}
        <div className="min-h-0 flex-1 overflow-hidden max-lg:border-t max-lg:border-[var(--border)] lg:rounded-tl-[var(--r-lg)] lg:border-t lg:border-l lg:border-[var(--border-soft)]">
          {child ? <Outlet /> : <ServerOverview />}
        </div>
      </div>
    </ServerFrameContext.Provider>
  );
}

/** Online, offline, or waiting for a plugin update. */
function ServerStateBadge({ summary }: { summary: ServerSummary }) {
  const { t } = useTranslation();
  return summary.updateRequired ? (
    <Badge variant="amber">{t("serverDetail.stateUpdateRequired")}</Badge>
  ) : summary.online ? (
    <Badge variant="sage">{t("serverDetail.stateOnline")}</Badge>
  ) : (
    <Badge variant="brick">{t("serverDetail.stateOffline")}</Badge>
  );
}

/** The versions the plugin reported on its last hello, at the end of the row. */
function ServerVersions({ summary }: { summary: ServerSummary }) {
  const { t } = useTranslation();
  const versions = [
    summary.minecraftVersion &&
      t("serverDetail.minecraftVersion", { version: summary.minecraftVersion }),
    summary.pluginVersion && t("serverDetail.pluginVersion", { version: summary.pluginVersion }),
  ].filter(Boolean);
  if (versions.length === 0) return null;
  return (
    <span
      className="ml-auto hidden shrink-0 items-center text-[11.5px] text-[var(--text-faint)] xl:flex"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {versions.join(" · ")}
    </span>
  );
}

const ROW_LINK =
  "group flex items-center justify-between gap-2 rounded-[var(--r-xs)] px-2 py-1.5 text-[13px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]";

/**
 * The overview tab: the admin's own modules first (what they came to edit),
 * then the installed modules with their projects and screens.
 */
function ServerOverview() {
  const { serverId, serverKeyId } = useServerFrame();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects, status, unavailableReason } = useServerProjectList(serverKeyId);
  const [importOpen, setImportOpen] = useState(false);
  const serverScreens = useServerScreensStore((s) => s.screens);
  const localProjects = useProjectsStore((s) => s.openProjects.projects);
  const mountedModuleIds = useModulesStore((s) => s.mountedIds);
  const navigationPinned = useSidebarStore((s) => s.pinned);

  // Config screens decide the grouping: the page loads them for ITS server
  // instead of waiting for the sidebar to do it — otherwise an owned project
  // first shows flat then jumps under its module. The call is idempotent (the
  // store ignores a source already loaded).
  useEffect(() => {
    if (!serverKeyId) return;
    useServerScreensStore.getState().load({ serverId: serverKeyId });
  }, [serverKeyId]);

  const updateRequired = status === "unavailable" && unavailableReason === "plugin_update_required";

  // Same split as the sidebar: the plugins' modules with their folders and screens,
  // then the admin's own folders.
  const { pluginModules, contentModules: projectRows } = buildModuleList({
    projects,
    screens: serverScreens,
    mountedModuleIds,
    localProjects,
  });

  return (
    <div className="h-full overflow-auto">
      {/* Lined up with the header's title, not centred: the page reads from the sidebar's edge. */}
      <div
        className={cx(
          "flex max-w-6xl flex-col gap-8 py-8 pr-6 pl-16 lg:pl-24",
          navigationPinned && "lg:pl-6",
        )}
      >
        <EditorAddressBanner />

        <Section
          title={t("serverDetail.myModules")}
          count={status === "ready" ? projectRows.length : undefined}
          actions={
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!serverKeyId || updateRequired}
              onClick={() => setImportOpen(true)}
            >
              {t("topbar.import")}
            </button>
          }
        >
          {status === "loading" ? (
            <p className="text-[13px] text-[var(--text-mut)]">
              {t("serverDetail.loadingProjects")}
            </p>
          ) : status === "unavailable" ? (
            <p className="text-[13px] text-[var(--text-mut)]">
              {t(
                updateRequired
                  ? "serverDetail.updateRequired"
                  : unavailableReason === "server_offline"
                    ? "serverDetail.serverOffline"
                    : "serverDetail.projectsUnavailable",
              )}
            </p>
          ) : projectRows.length === 0 ? (
            <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.noProjects")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {projectRows.map((w) => (
                <li key={w.id} className="flex min-w-0 flex-col gap-1.5">
                  <Link
                    to="/servers/$serverId/projects/$projectId"
                    params={{ serverId, projectId: projectUrlId(w) }}
                    className="card group flex items-center gap-3 p-3.5 transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--surface-hover)]"
                  >
                    {/* No Document counter: the hub does not hold the files, so it
                        cannot know it without querying the server's disk. */}
                    <IconTile icon={Folder} fg="var(--brand)" soft="var(--brand-soft)" size="md" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--text)]">
                      {w.name}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
                  </Link>
                  {/* The ID is changed in the project Properties; only resuming a pending change remains here. */}
                  {w.pendingRename && (
                    <RenameProjectButton
                      project={w}
                      onRenamed={(diskId) => {
                        if (serverKeyId)
                          onProjectRenamed({
                            projectId: w.id,
                            serverKeyId,
                            previousDiskId: w.externalId ?? w.id,
                            diskId,
                          });
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {status === "ready" && pluginModules.length > 0 && (
          <Section title={t("sidebar.installedModules")} count={pluginModules.length}>
            <ul className="grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {pluginModules.map((m) => (
                <li key={m.id} className="card flex flex-col gap-2 p-3">
                  {/* TODO: render the module's icon once modules ship real icons */}
                  <span className="flex items-center gap-2.5 px-1 text-[14px] font-semibold text-[var(--text)]">
                    <IconTile
                      icon={Puzzle}
                      fg="var(--kind-module)"
                      soft="var(--kind-module-soft)"
                      size="sm"
                    />
                    {m.label}
                  </span>
                  <ul className="flex flex-col border-t border-[var(--border-soft)] pt-1.5">
                    {m.projects.map((p) => (
                      <li key={`p:${p.id}`}>
                        <Link
                          to="/servers/$serverId/projects/$projectId"
                          params={{ serverId, projectId: projectUrlId(p) }}
                          className={ROW_LINK}
                        >
                          {m.projects.length === 1 ? t("serverDetail.openModule") : p.name}
                          <RowChevron />
                        </Link>
                      </li>
                    ))}
                    {m.entries.map((e) =>
                      e.kind === "screen" ? (
                        <li key={`s:${e.screen.id}`}>
                          <Link
                            {...screenDestination(e.screen, serverId, m.projects)}
                            className={ROW_LINK}
                          >
                            {e.screen.label}
                            <RowChevron />
                          </Link>
                        </li>
                      ) : (
                        <li key={`c:${e.moduleId}`}>
                          <Link
                            to="/m/$moduleId"
                            params={{ moduleId: e.moduleId }}
                            className={ROW_LINK}
                          >
                            {t("sidebar.configuration")}
                            <RowChevron />
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {serverKeyId && (
          <ImportProjectDialog
            serverKeyId={serverKeyId}
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImported={(projectId) => {
              setImportOpen(false);
              navigate({
                to: "/servers/$serverId/projects/$projectId",
                params: { serverId, projectId },
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

function RowChevron() {
  return (
    <ChevronRight className="size-3.5 shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5" />
  );
}

/** An overview section: eyebrow title, its count, a rule, then its actions. */
function Section({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="eyebrow">{title}</h2>
        {count !== undefined && (
          <span className="text-[12px] tabular-nums text-[var(--text-faint)]">{count}</span>
        )}
        <span className="h-px flex-1 bg-[var(--border-soft)]" />
        {actions}
      </div>
      {children}
    </section>
  );
}

export interface ServerProjectList {
  projects: ProjectSummary[];
  /** Three states, never confused: reading, read, could not read. */
  status: "loading" | "ready" | "unavailable";
  /** Why the list is missing, when the server says so (offline, plugin to update). */
  unavailableReason: string | null;
}

/**
 * The server's projects, read from its disk as in the sidebar: the hub keeps no
 * list of them (ADR `server-disk-only-storage`), the folder name IS the identity.
 *
 * An offline server is not a server without projects — announcing it empty
 * would assert an emptiness not observed.
 */
export function useServerProjectList(serverKeyId: string | null): ServerProjectList {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState<ServerProjectList["status"]>("loading");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  useEffect(() => {
    const renamed = (raw: Event) => {
      const event = (raw as CustomEvent<ProjectRenamed>).detail;
      if (event.serverKeyId !== serverKeyId) return;
      setProjects((current) =>
        current.map((project) =>
          project.id === event.projectId
            ? {
                ...project,
                externalId: event.diskId,
                name: project.name === event.previousDiskId ? event.diskId : project.name,
              }
            : project,
        ),
      );
    };
    window.addEventListener("ifz:project_renamed", renamed);
    return () => window.removeEventListener("ifz:project_renamed", renamed);
  }, [serverKeyId]);

  const reload = useCallback(
    (quiet = false) => {
      if (!serverKeyId) return undefined;
      let cancelled = false;
      if (!quiet) setStatus("loading");
      listServerProjects(serverKeyId).then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setProjects([]);
          setStatus("unavailable");
          setUnavailableReason(res.error);
          return;
        }
        setProjects(diskProjectsToSummaries(serverKeyId, res.projectIds, res.projects));
        setStatus("ready");
      });
      return () => {
        cancelled = true;
      };
    },
    [serverKeyId],
  );

  useEffect(() => reload(), [reload]);

  // A reload can add or drop folders (an add-on registers its own after the server started).
  useEffect(() => {
    const reloaded = (e: Event) => {
      if ((e as CustomEvent<ProjectsReloaded>).detail.serverKeyId === serverKeyId) reload(true);
    };
    window.addEventListener(PROJECTS_RELOADED_EVENT, reloaded);
    return () => window.removeEventListener(PROJECTS_RELOADED_EVENT, reloaded);
  }, [serverKeyId, reload]);

  return { projects, status, unavailableReason };
}
