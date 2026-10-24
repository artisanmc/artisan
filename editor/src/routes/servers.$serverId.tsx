import { IconTile } from "@/components/ui/icon-tile";
import { ImportProjectDialog } from "@/features/import/ImportProjectDialog";
import { type ProjectRenamed, onProjectRenamed } from "@/features/project/onProjectRenamed";
import {
  PROJECTS_RELOADED_EVENT,
  type ProjectsReloaded,
} from "@/features/project/onProjectsReloaded";
import { RenameProjectButton } from "@/features/projects/RenameProjectButton";
import { buildModuleList, diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { ServerConfigSection } from "@/features/serverConfig/ServerConfigSection";
import { EditorAddressBanner } from "@/features/settings/EditorAddressBanner";
import { listServerProjects } from "@/lib/api/projectFiles";
import { type ProjectSummary, listServers } from "@/lib/api/servers";
import { screenDestination } from "@/lib/projectNavigation";
import { projectUrlId } from "@/lib/projectUrlId";
import { displayServerLabel } from "@/lib/serverLabel";
import { useAuthStore } from "@/state/authStore";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import {
  Link,
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { ChevronRight, Folder, Puzzle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId")({
  component: ServerDetailPage,
});

/**
 * The frame: who you are, which server, and whether this page is really the
 * one being viewed.
 *
 * It subscribes to NO editing state — when a child route fills the screen,
 * this component is only a pass-through to `<Outlet>`, and a parent that
 * re-renders re-renders the whole canvas below it. Everything live (disk read,
 * projects, modules) moved down into `ServerOverview`, which only exists when
 * the overview is actually displayed.
 */
export default function ServerDetailPage() {
  const { serverId } = useParams({
    from: "/servers/$serverId",
  });
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const authLoading = useAuthStore((s) => s.isLoading);
  const [serverDisplayLabel, setServerDisplayLabel] = useState<string | null>(null);
  const [serverKeyId, setServerKeyId] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const childMatches = useChildMatches();

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
        setServerDisplayLabel(displayServerLabel(sk));
        setServerKeyId(sk.id);
      })
      .catch((e: Error & { status?: number }) => {
        if (e?.status === 403) {
          setAccessDenied(true);
        } else if (e?.status === 404) {
          navigate({ to: "/servers", replace: true });
        } else console.error(e);
      });
  }, [serverId, navigate]);

  if (accessDenied)
    return (
      <div className="flex h-full items-center justify-center p-8 text-[var(--text-mut)]">
        {t("serverDetail.accessDenied")}
      </div>
    );
  if (childMatches.length > 0) return <Outlet />;

  return (
    <ServerOverview
      serverId={serverId}
      serverKeyId={serverKeyId}
      label={serverDisplayLabel ?? serverId}
    />
  );
}

function ServerOverview({
  serverId,
  serverKeyId,
  label,
}: {
  /** URL form (usually a slug) — the one links carry. */
  serverId: string;
  /** Real server_key id, `null` until the network has answered. */
  serverKeyId: string | null;
  label: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  /** Why the list is missing, when the server says so (offline, plugin to update). */
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const serverScreens = useServerScreensStore((s) => s.screens);
  const localProjects = useProjectsStore((s) => s.openProjects.projects);
  const mountedModuleIds = useModulesStore((s) => s.mountedIds);
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

  /**
   * Projects are read from the server's disk, as in the sidebar: the hub keeps
   * no list of them (ADR `server-disk-only-storage`), the folder name IS the
   * identity.
   *
   * Three states, never confused: reading, read, could not read. An offline
   * server is not a server without projects — announcing it empty would assert
   * an emptiness not observed.
   */
  const reloadProjects = useCallback(
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

  useEffect(() => reloadProjects(), [reloadProjects]);

  // A reload can add or drop folders (an add-on registers its own after the server started).
  useEffect(() => {
    const reloaded = (e: Event) => {
      if ((e as CustomEvent<ProjectsReloaded>).detail.serverKeyId === serverKeyId)
        reloadProjects(true);
    };
    window.addEventListener(PROJECTS_RELOADED_EVENT, reloaded);
    return () => window.removeEventListener(PROJECTS_RELOADED_EVENT, reloaded);
  }, [serverKeyId, reloadProjects]);

  // Config screens decide the grouping: the page loads them for ITS server
  // instead of waiting for the sidebar to do it — otherwise an owned project
  // first shows flat then jumps under its module. The call is idempotent (the
  // store ignores a source already loaded).
  useEffect(() => {
    if (!serverKeyId) return;
    useServerScreensStore.getState().load({ serverId: serverKeyId });
  }, [serverKeyId]);

  // Same split as the sidebar: the plugins' modules with their folders and screens,
  // then the admin's own folders.
  const updateRequired = status === "unavailable" && unavailableReason === "plugin_update_required";

  const { pluginModules, contentModules: projectRows } = buildModuleList({
    projects,
    screens: serverScreens,
    mountedModuleIds,
    localProjects,
  });

  return (
    <div className="relative h-full overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-12">
        <header>
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {label}
          </h1>
        </header>

        <EditorAddressBanner />

        {status === "ready" && pluginModules.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 className="eyebrow">{t("sidebar.installedModules")}</h2>
              <span className="h-px flex-1 bg-[var(--border-soft)]" />
            </div>
            <ul className="flex flex-col gap-2">
              {pluginModules.map((m) => (
                <li key={m.id} className="card flex flex-col gap-3 p-4">
                  {/* TODO: render the module's icon once modules ship real icons */}
                  <span className="flex items-center gap-2.5 text-[14px] font-semibold text-[var(--text)]">
                    <IconTile
                      icon={Puzzle}
                      fg="var(--kind-module)"
                      soft="var(--kind-module-soft)"
                      size="sm"
                    />
                    {m.label}
                  </span>
                  <ul className="flex flex-wrap gap-1.5">
                    {m.projects.map((p) => (
                      <li key={`p:${p.id}`}>
                        <Link
                          to="/servers/$serverId/projects/$projectId"
                          params={{ serverId, projectId: projectUrlId(p) }}
                          className="chip"
                        >
                          {m.projects.length === 1 ? t("serverDetail.openModule") : p.name}
                        </Link>
                      </li>
                    ))}
                    {m.entries.map((e) =>
                      e.kind === "screen" ? (
                        <li key={`s:${e.screen.id}`}>
                          <Link
                            {...screenDestination(e.screen, serverId, m.projects)}
                            className="chip"
                          >
                            {e.screen.label}
                          </Link>
                        </li>
                      ) : (
                        <li key={`c:${e.moduleId}`}>
                          <Link
                            to="/m/$moduleId"
                            params={{ moduleId: e.moduleId }}
                            className="chip"
                          >
                            {t("sidebar.configuration")}
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="eyebrow">{t("serverDetail.myModules")}</h2>
            <span className="h-px flex-1 bg-[var(--border-soft)]" />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!serverKeyId || updateRequired}
              onClick={() => setImportOpen(true)}
            >
              {t("topbar.import")}
            </button>
            <Link
              to="/servers/$serverId/canvas"
              params={{ serverId }}
              className="btn btn-ghost btn-sm"
            >
              {t("serverDetail.openBoard")}
            </Link>
          </div>
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
            <ul className="flex flex-col gap-2">
              {projectRows.map((w) => (
                <li key={w.id} className="flex items-center gap-2">
                  <Link
                    to="/servers/$serverId/projects/$projectId"
                    params={{ serverId, projectId: projectUrlId(w) }}
                    className="card group flex flex-1 items-center gap-3 p-3.5 transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--surface-hover)]"
                  >
                    {/* No Document counter: the hub does not hold the files, so it
                        cannot know it without querying the server's disk. */}
                    <IconTile icon={Folder} fg="var(--brand)" soft="var(--brand-soft)" size="md" />
                    <span className="flex-1 text-[14px] font-medium text-[var(--text)]">
                      {w.name}
                    </span>
                    <ChevronRight className="size-4 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
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
        </section>

        {serverKeyId && !updateRequired && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 className="eyebrow">{t("serverConfig.title")}</h2>
              <span className="h-px flex-1 bg-[var(--border-soft)]" />
            </div>
            <p className="text-[12px] text-[var(--text-mut)]">{t("serverConfig.connectionHint")}</p>
            <ServerConfigSection serverKeyId={serverKeyId} projects={projects} />
          </section>
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
