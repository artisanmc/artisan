import { Breadcrumb, BreadcrumbCurrent, BreadcrumbSwitcher } from "@/components/ui/breadcrumb";
import { type ServerKeySummary, getNetwork } from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
import { useNetworksStore } from "@/state/networksStore";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Serveur › project, en tête de la topbar. Le network n'est plus qu'en infobulle
 * du serveur, pour laisser la place aux onglets. Le serveur ouvre la liste des
 * serveurs du network : en choisir un mène à sa page.
 * Hors network (démo), seul le project s'affiche.
 */
export function ProjectBreadcrumb({
  networkRef,
  serverRef,
  projectName,
  serverStatus,
}: {
  networkRef: string | null | undefined;
  serverRef: string | null | undefined;
  projectName: string;
  /** Pastille d'état du serveur, devant son nom. */
  serverStatus?: ReactNode;
}) {
  const { t } = useTranslation();
  const networkName = useNetworksStore(
    (s) => s.networks.find((n) => n.id === networkRef || n.slug === networkRef)?.name,
  );
  const navigate = useNavigate();
  const [servers, setServers] = useState<ServerKeySummary[]>([]);
  useEffect(() => {
    setServers([]);
    if (!networkRef || !serverRef) return;
    let cancelled = false;
    getNetwork(networkRef)
      .then((res) => {
        if (!cancelled) setServers(res.serverKeys);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [networkRef, serverRef]);
  const current = servers.find((k) => k.id === serverRef || k.slug === serverRef);
  const serverLabel = current ? displayServerLabel(current) : serverRef;

  return (
    <Breadcrumb label={t("breadcrumb.label")}>
      {networkRef && serverRef && (
        <span className="flex min-w-0 items-center">
          {serverStatus}
          <BreadcrumbSwitcher
            current={current?.id ?? serverRef}
            title={`${networkName ?? networkRef} › ${serverLabel}`}
            searchPlaceholder={t("breadcrumb.searchServers")}
            items={servers.map((k) => ({
              id: k.id,
              label: displayServerLabel(k),
              leading: (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: k.online ? "var(--success)" : "var(--text-faint)" }}
                />
              ),
            }))}
            onSelect={(id) => {
              const key = servers.find((k) => k.id === id);
              if (!key) return;
              navigate({
                to: "/networks/$networkId/servers/$serverId",
                params: { networkId: networkRef, serverId: key.slug ?? key.id },
              });
            }}
          />
        </span>
      )}
      <BreadcrumbCurrent title={projectName}>{projectName}</BreadcrumbCurrent>
    </Breadcrumb>
  );
}
