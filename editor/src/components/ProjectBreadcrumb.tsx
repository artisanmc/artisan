import {
  Breadcrumb,
  BreadcrumbCurrent,
  BreadcrumbSwitcher,
  breadcrumbLinkClass,
} from "@/components/ui/breadcrumb";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { type ServerSummary, listServers } from "@/lib/api/servers";
import { displayServerLabel } from "@/lib/serverLabel";
import type { DocumentTrail } from "@/state/documentTrailStore";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Server › project, at the head of the topbar, then the open Document's levels
 * (its collection, itself). The server opens the list of the hub's servers:
 * picking one leads to its page. With a Document open, the project and the
 * collection lead back to their pages. Outside a server (demo), no server.
 */
export function ProjectBreadcrumb({
  serverRef,
  projectName,
  serverStatus,
  trail,
}: {
  serverRef: string | null | undefined;
  projectName: string;
  /** Server status dot, before its name. */
  serverStatus?: ReactNode;
  /** The open Document, from `DocumentView`. */
  trail?: DocumentTrail | null;
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
      {trail ? (
        <button
          type="button"
          onClick={trail.toProject}
          title={projectName}
          className={breadcrumbLinkClass}
        >
          {projectName}
        </button>
      ) : (
        <BreadcrumbCurrent title={projectName}>{projectName}</BreadcrumbCurrent>
      )}
      {trail?.collection && (
        <button
          type="button"
          onClick={trail.collection.open}
          title={trail.collection.label}
          className={breadcrumbLinkClass}
        >
          {trail.collection.label}
        </button>
      )}
      {trail && (
        <BreadcrumbCurrent>
          {/* MiniMessage (a menu's title): its style, not its tags. */}
          <MiniMessageInline source={trail.label} />
        </BreadcrumbCurrent>
      )}
    </Breadcrumb>
  );
}
