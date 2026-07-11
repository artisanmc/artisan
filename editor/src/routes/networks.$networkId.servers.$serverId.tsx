import { getNetwork } from "@/lib/api/networks";
import type { ProjectSummary } from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
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
  const [serverDisplayLabel, setServerDisplayLabel] = useState<string | null>(null);
  const [workspaces, setProjects] = useState<ProjectSummary[]>([]);
  const childMatches = useChildMatches();

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
        // Stale/inaccessible network → bounce to the user's own networks list.
        if (e?.status === 403 || e?.status === 404) {
          navigate({ to: "/networks", replace: true });
        } else console.error(e);
      });
  }, [networkId, serverId, navigate]);

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
                    params={{ networkId, serverId, projectId: w.id }}
                    className="card flex items-center justify-between p-4 hover:bg-[var(--surface-hover)]"
                  >
                    <span className="text-[14px] font-medium text-[var(--text)]">{w.name}</span>
                    {w.documentCount != null && (
                      <span
                        title={t("serverDetail.documentCount", { count: w.documentCount })}
                        aria-label={t("serverDetail.documentCount", { count: w.documentCount })}
                        className="shrink-0 rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[12px] font-medium tabular-nums text-[var(--text-mut)]"
                      >
                        {w.documentCount}
                      </span>
                    )}
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
