import { createFileRoute, Link, Outlet, useChildMatches, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getNetwork } from "@/lib/api/networks";
import type { PackSummary } from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$networkId/servers/$serverId")({
  component: ServerDetailPage,
});

export default function ServerDetailPage() {
  const { t } = useTranslation();
  const { networkId, serverId } = useParams({
    from: "/networks/$networkId/servers/$serverId",
  });
  const [serverLabel, setServerLabel] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<PackSummary[]>([]);
  const childMatches = useChildMatches();

  useEffect(() => {
    if (!networkId || !serverId) return;
    getNetwork(networkId)
      .then((d) => {
        const sk = d.serverKeys.find((k) => k.id === serverId);
        setServerLabel(sk?.label ?? null);
        setWorkspaces(d.packs.filter((p) => p.serverKeyId === serverId));
      })
      .catch(console.error);
  }, [networkId, serverId]);

  if (childMatches.length > 0) return <Outlet />;

  return (
    <div className="relative h-full overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-12">
        <header>
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {serverLabel ?? serverId}
          </h1>
        </header>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="eyebrow">{t("serverDetail.workspaces")}</h2>
            <span className="h-px flex-1 bg-[var(--border-soft)]" />
          </div>
          {workspaces.length === 0 ? (
            <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.noWorkspaces")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <Link
                    to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
                    params={{ networkId, serverId, workspaceId: w.id }}
                    className="card flex items-center justify-between p-4 hover:bg-[var(--surface-hover)]"
                  >
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
