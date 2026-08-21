import { RequestAccessPanel } from "@/components/network-detail/RequestAccessPanel";
import { buildProjectGroups } from "@/features/projects/projectGroups";
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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/networks/$networkId/servers/$serverId")({
  component: ServerDetailPage,
});

export default function ServerDetailPage() {
  const { t } = useTranslation();
  const { networkId, serverId } = useParams({
    from: "/networks/$networkId/servers/$serverId",
  });
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const authLoading = useAuthStore((s) => s.isLoading);
  const [serverDisplayLabel, setServerDisplayLabel] = useState<string | null>(null);
  const [serverKeyId, setServerKeyId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);
  const childMatches = useChildMatches();
  const serverScreens = useServerScreensStore((s) => s.screens);
  const localProjects = useAccountStore((s) => s.account.projects);
  const mountedModuleIds = useModulesStore((s) => s.mountedIds);

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
        setServerDisplayLabel(sk ? displayServerLabel(sk) : null);
        setServerKeyId(sk?.id ?? null);
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

  /**
   * Les Projects se lisent sur le disque du serveur, comme dans la sidebar : le
   * backend n'en tient plus de liste (ADR `server-disk-only-storage`), le nom du
   * dossier EST l'identité. Serveur hors ligne → liste vide.
   */
  useEffect(() => {
    if (!serverKeyId) return;
    let cancelled = false;
    listServerProjects(networkId, serverKeyId).then((res) => {
      if (cancelled) return;
      setProjects(
        res.ok
          ? res.projectIds.map((id) => ({
              id,
              name: id,
              slug: id,
              hash: "",
              networkId,
              serverKeyId,
            }))
          : [],
      );
    });
    return () => {
      cancelled = true;
    };
  }, [networkId, serverKeyId]);

  // Même découpage que la sidebar — projects ordinaires d'un côté, modules
  // installés de l'autre avec leurs onglets (ADR `addon-owned-project-roots`).
  const { flatProjects, moduleGroups } = buildProjectGroups({
    projects,
    screens: serverScreens,
    mountedModuleIds,
    localProjects,
  });

  if (accessDenied) return <RequestAccessPanel networkIdOrSlug={networkId} />;
  if (childMatches.length > 0) return <Outlet />;

  return (
    <div className="relative h-full overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-12">
        <header>
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {serverDisplayLabel ?? serverId}
          </h1>
        </header>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="eyebrow">{t("serverDetail.projects")}</h2>
            <span className="h-px flex-1 bg-[var(--border-soft)]" />
          </div>
          {flatProjects.length === 0 ? (
            <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.noProjects")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {flatProjects.map((w) => (
                <li key={w.id}>
                  <Link
                    to="/networks/$networkId/servers/$serverId/projects/$projectId"
                    params={{ networkId, serverId, projectId: w.slug || w.id }}
                    className="card flex items-center justify-between p-4 hover:bg-[var(--surface-hover)]"
                  >
                    {/* Plus de compteur de Documents : le backend ne détient
                        plus les fichiers (ADR `server-disk-only-storage`), donc
                        il ne peut plus le connaître sans interroger le disque du
                        serveur. Un compteur figé de l'ancien monde aurait menti. */}
                    <span className="text-[14px] font-medium text-[var(--text)]">{w.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

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
                                projectId: e.project.slug || e.project.id,
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
      </div>
    </div>
  );
}
