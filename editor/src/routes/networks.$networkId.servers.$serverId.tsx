import { RequestAccessPanel } from "@/components/network-detail/RequestAccessPanel";
import { getNetwork } from "@/lib/api/networks";
import type { ProjectSummary } from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
import { useAuthStore } from "@/state/authStore";
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
  const [workspaces, setProjects] = useState<ProjectSummary[]>([]);
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
        setServerDisplayLabel(sk ? displayServerLabel(sk) : null);
        setProjects(sk ? d.projects.filter((p) => p.serverKeyId === sk.id) : []);
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
          {workspaces.length === 0 ? (
            <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.noProjects")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {workspaces.map((w) => (
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
      </div>
    </div>
  );
}
