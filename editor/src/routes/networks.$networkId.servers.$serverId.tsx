import { projectUrlId } from "@/lib/projectUrlId";
import { RequestAccessPanel } from "@/components/network-detail/RequestAccessPanel";
import { ImportProjectDialog } from "@/features/import/ImportProjectDialog";
import { buildProjectGroups, diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { RenameProjectButton } from "@/features/projects/RenameProjectButton";
import { onProjectRenamed, type ProjectRenamed } from "@/features/project/onProjectRenamed";
import { getNetwork } from "@/lib/api/networks";
import type { ProjectSummary } from "@/lib/api/networks";
import { listServerProjects } from "@/lib/api/projectFiles";
import { displayServerLabel } from "@/lib/serverLabel";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useModulesStore } from "@/state/modulesStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import {
  Link,
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/networks/$networkId/servers/$serverId")({
  component: ServerDetailPage,
});

/**
 * Le cadre : qui es-tu, quel serveur, et est-ce bien cette page qu'on regarde.
 *
 * Il ne s'abonne à AUCUN état d'édition — quand une route enfant occupe
 * l'écran, ce composant n'est qu'un passe-plat vers `<Outlet>`, et un parent
 * qui se re-rend re-rend tout le canvas sous lui. Tout ce qui vit et respire
 * (lecture disque, projects, modules) est descendu dans `ServerOverview`, qui
 * n'existe que lorsque la vue d'ensemble est réellement affichée.
 */
export default function ServerDetailPage() {
  const { networkId, serverId } = useParams({
    from: "/networks/$networkId/servers/$serverId",
  });
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
    if (!networkId || !serverId) return;
    getNetwork(networkId)
      .then((d) => {
        // serverId param is the server slug (old links may still pass the id).
        const sk = d.serverKeys.find((k) => k.slug === serverId || k.id === serverId);
        if (!sk) {
          // Le network existe, ce serveur non : l'URL est périmée. On renvoie au
          // network — l'alternative serait d'attendre indéfiniment une lecture
          // disque qu'on ne peut adresser à personne.
          navigate({ to: "/networks/$networkId", params: { networkId }, replace: true });
          return;
        }
        setServerDisplayLabel(displayServerLabel(sk));
        setServerKeyId(sk.id);
      })
      .catch((e: Error & { status?: number }) => {
        // A logged-in user without membership → offer to request access instead
        // of bouncing. A stale/nonexistent id (404) still bounces.
        if (e?.status === 403) {
          setAccessDenied(true);
        } else if (e?.status === 404) {
          navigate({ to: "/networks", replace: true });
        } else console.error(e);
      });
  }, [networkId, serverId, navigate]);

  if (accessDenied) return <RequestAccessPanel networkIdOrSlug={networkId} />;
  if (childMatches.length > 0) return <Outlet />;

  return (
    <ServerOverview
      networkId={networkId}
      serverId={serverId}
      serverKeyId={serverKeyId}
      label={serverDisplayLabel ?? serverId}
    />
  );
}

function ServerOverview({
  networkId,
  serverId,
  serverKeyId,
  label,
}: {
  networkId: string;
  /** Forme URL (slug le plus souvent) — celle que portent les liens. */
  serverId: string;
  /** Id réel du server_key, `null` tant que le network n'a pas répondu. */
  serverKeyId: string | null;
  label: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [importOpen, setImportOpen] = useState(false);
  const serverScreens = useServerScreensStore((s) => s.screens);
  const localProjects = useAccountStore((s) => s.account.projects);
  const mountedModuleIds = useModulesStore((s) => s.mountedIds);
  useEffect(() => {
    const renamed = (raw: Event) => {
      const event = (raw as CustomEvent<ProjectRenamed>).detail;
      if (event.serverKeyId !== serverKeyId) return;
      setProjects((current) => current.map((project) => project.id === event.projectId
        ? { ...project, externalId: event.diskId, name: project.name === event.previousDiskId ? event.diskId : project.name }
        : project));
    };
    window.addEventListener("ifz:project_renamed", renamed);
    return () => window.removeEventListener("ifz:project_renamed", renamed);
  }, [serverKeyId]);

  /**
   * Les Projects se lisent sur le disque du serveur, comme dans la sidebar : le
   * backend n'en tient plus de liste (ADR `server-disk-only-storage`), le nom du
   * dossier EST l'identité.
   *
   * Trois états, jamais confondus : on lit, on a lu, on n'a pas pu lire. Un
   * serveur hors ligne n'est pas un serveur sans projects — l'annoncer vide
   * serait affirmer un vide qu'on n'a pas constaté.
   */
  const reloadProjects = useCallback(() => {
    if (!serverKeyId) return undefined;
    let cancelled = false;
    setStatus("loading");
    listServerProjects(networkId, serverKeyId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setProjects([]);
        setStatus("unavailable");
        return;
      }
      setProjects(diskProjectsToSummaries(networkId, serverKeyId, res.projectIds, res.projects));
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [networkId, serverKeyId]);

  useEffect(() => reloadProjects(), [reloadProjects]);

  // Les Config screens décident du regroupement : la page les charge pour SON
  // serveur au lieu d'attendre que la sidebar l'ait fait — sinon un project
  // possédé s'affiche d'abord à plat puis saute sous son module. L'appel est
  // idempotent (le store ignore une source déjà chargée).
  useEffect(() => {
    if (!serverKeyId) return;
    useServerScreensStore.getState().load({ networkId, serverId: serverKeyId });
  }, [networkId, serverKeyId]);

  // Même découpage que la sidebar — projects ordinaires d'un côté, modules
  // installés de l'autre avec leurs onglets (ADR `addon-owned-project-roots`).
  const { flatProjects, moduleGroups } = buildProjectGroups({
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

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="eyebrow">{t("serverDetail.projects")}</h2>
            <span className="h-px flex-1 bg-[var(--border-soft)]" />
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={!serverKeyId}
              onClick={() => setImportOpen(true)}
            >
              {t("topbar.import")}
            </button>
            <Link
              to="/networks/$networkId/servers/$serverId/canvas"
              params={{ networkId, serverId }}
              className="btn-ghost btn-sm"
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
              {t("serverDetail.projectsUnavailable")}
            </p>
          ) : flatProjects.length === 0 ? (
            <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.noProjects")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {flatProjects.map((w) => (
                <li key={w.id} className="flex items-center gap-2">
                  <Link
                    to="/networks/$networkId/servers/$serverId/projects/$projectId"
                    params={{ networkId, serverId, projectId: projectUrlId(w) }}
                    className="card flex flex-1 items-center justify-between p-4 hover:bg-[var(--surface-hover)]"
                  >
                    {/* Plus de compteur de Documents : le backend ne détient
                        plus les fichiers (ADR `server-disk-only-storage`), donc
                        il ne peut plus le connaître sans interroger le disque du
                        serveur. Un compteur figé de l'ancien monde aurait menti. */}
                    <span className="text-[14px] font-medium text-[var(--text)]">{w.name}</span>
                  </Link>
                  {/* L'ID se modifie dans les Propriétés du projet ; ici ne reste que la reprise d'un changement en attente. */}
                  {w.pendingRename && <RenameProjectButton project={w} onRenamed={(diskId) => { if (serverKeyId) onProjectRenamed({ projectId: w.id, serverKeyId, previousDiskId: w.externalId ?? w.id, diskId }); }} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {status === "ready" && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 className="eyebrow">{t("sidebar.installedModules")}</h2>
              <span className="h-px flex-1 bg-[var(--border-soft)]" />
            </div>
            {moduleGroups.length === 0 ? (
              <p className="text-[13px] text-[var(--text-mut)]">{t("sidebar.noModules")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {moduleGroups.map((g) => (
                  <li key={g.id} className="card flex flex-col gap-3 p-4">
                    {/* TODO(P2): render the module's icon once modules ship real icons */}
                    <span className="text-[14px] font-semibold text-[var(--text)]">{g.label}</span>
                    <ul className="flex flex-wrap gap-1.5">
                      {g.entries.map((e) => {
                        if (e.kind === "project") {
                          return (
                            <li key={`p:${e.project.id}`}>
                              <Link
                                to="/networks/$networkId/servers/$serverId/projects/$projectId"
                                params={{
                                  networkId,
                                  serverId,
                                  projectId: projectUrlId(e.project),
                                }}
                                className="chip"
                              >
                                {e.label ?? t("screens.editorEntry")}
                              </Link>
                            </li>
                          );
                        }
                        if (e.kind === "screen") {
                          return (
                            <li key={`s:${e.screen.id}`}>
                              <Link
                                to="/networks/$networkId/servers/$serverId/screens/$screenId"
                                params={{ networkId, serverId, screenId: e.screen.id }}
                                className="chip"
                              >
                                {e.screen.label}
                              </Link>
                            </li>
                          );
                        }
                        return (
                          <li key={`c:${e.moduleId}`}>
                            <Link
                              to="/m/$moduleId"
                              params={{ moduleId: e.moduleId }}
                              className="chip"
                            >
                              {t("sidebar.configuration")}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {serverKeyId && (
          <ImportProjectDialog
            networkId={networkId}
            serverKeyId={serverKeyId}
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImported={(projectId) => {
              setImportOpen(false);
              navigate({
                to: "/networks/$networkId/servers/$serverId/projects/$projectId",
                params: { networkId, serverId, projectId },
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
