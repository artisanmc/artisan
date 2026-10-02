import { Breadcrumb, BreadcrumbCurrent, breadcrumbLinkClass } from "@/components/ui/breadcrumb";
import { getNetwork } from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
import { useNetworksStore } from "@/state/networksStore";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Network › serveur › project, en tête de la topbar : chaque niveau mène à sa
 * page. Remplace le sélecteur de serveur et le lien vers le network de la barre
 * de gauche — changer de serveur passe par ici. Hors network (démo), seul le
 * project s'affiche.
 */
export function ProjectBreadcrumb({
  networkRef,
  serverRef,
  projectName,
}: {
  networkRef: string | null | undefined;
  serverRef: string | null | undefined;
  projectName: string;
}) {
  const { t } = useTranslation();
  const networkName = useNetworksStore(
    (s) => s.networks.find((n) => n.id === networkRef || n.slug === networkRef)?.name,
  );
  const [serverLabel, setServerLabel] = useState<string | null>(null);
  useEffect(() => {
    setServerLabel(null);
    if (!networkRef || !serverRef) return;
    let cancelled = false;
    getNetwork(networkRef)
      .then((res) => {
        const key = res.serverKeys.find((k) => k.id === serverRef || k.slug === serverRef);
        if (!cancelled && key) setServerLabel(displayServerLabel(key));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [networkRef, serverRef]);

  return (
    <Breadcrumb label={t("breadcrumb.label")}>
      {networkRef && (
        <Link
          to="/networks/$networkId"
          params={{ networkId: networkRef }}
          className={breadcrumbLinkClass}
        >
          {networkName ?? networkRef}
        </Link>
      )}
      {networkRef && serverRef && (
        <Link
          to="/networks/$networkId/servers/$serverId"
          params={{ networkId: networkRef, serverId: serverRef }}
          className={breadcrumbLinkClass}
        >
          {serverLabel ?? serverRef}
        </Link>
      )}
      <BreadcrumbCurrent title={projectName}>{projectName}</BreadcrumbCurrent>
    </Breadcrumb>
  );
}
