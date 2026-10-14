import { Breadcrumb, BreadcrumbCurrent, BreadcrumbSwitcher } from "@/components/ui/breadcrumb";
import { type ServerSummary, listServers } from "@/lib/api/servers";
import { displayServerLabel } from "@/lib/serverLabel";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Server › project, at the head of the topbar. The server opens the list of
 * the hub's servers: picking one leads to its page.
 * Outside a server (demo), only the project is shown.
 */
export function ProjectBreadcrumb({
  serverRef,
  projectName,
  serverStatus,
}: {
  serverRef: string | null | undefined;
  projectName: string;
  /** Server status dot, before its name. */
  serverStatus?: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [servers, setServers] = useState<ServerSummary[]>([]);
  useEffect(() => {
    setServers([]);
    if (!serverRef) return;
    let cancelled = false;
    listServers()
      .then((list) => {
        if (!cancelled) setServers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverRef]);
  const current = servers.find((k) => k.id === serverRef);
  const serverLabel = current ? displayServerLabel(current) : serverRef;

  return (
    <Breadcrumb label={t("breadcrumb.label")}>
      {serverRef && (
        <span className="flex min-w-0 items-center">
          {serverStatus}
          <BreadcrumbSwitcher
            current={current?.id ?? serverRef}
            title={serverLabel ?? undefined}
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
              if (!servers.some((k) => k.id === id)) return;
              navigate({ to: "/servers/$serverId", params: { serverId: id } });
            }}
          />
        </span>
      )}
      <BreadcrumbCurrent title={projectName}>{projectName}</BreadcrumbCurrent>
    </Breadcrumb>
  );
}
