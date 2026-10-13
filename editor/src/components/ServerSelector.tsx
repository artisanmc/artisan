import { Badge } from "@/components/ui/badge";
import { displayServerLabel } from "@/lib/serverLabel";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface ServerEntry {
  serverId: string;
  /** URL slug — the serverId URL param may carry it instead of the id. */
  serverSlug?: string;
  serverLabel: string;
  networkId: string;
  /** URL slug — the networkId URL param may carry it instead of the id. */
  networkSlug?: string;
  networkName: string;
  /** Absent = état inconnu : rien n'est affiché plutôt qu'un hors-ligne supposé. */
  online?: boolean;
  /** Plugin trop différent du hub : listé, mais pas éditable. */
  updateRequired?: boolean;
}

/** Pastille + mention d'état d'un serveur ; rien tant que l'état n'est pas connu. */
function ServerState({ entry }: { entry: ServerEntry }) {
  const { t } = useTranslation();
  if (entry.updateRequired)
    return (
      <Badge variant="brick" data-testid="server-state-updateRequired">
        {t("linkedServers.updateRequired")}
      </Badge>
    );
  if (entry.online === undefined) return null;
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-faint)]"
      data-testid={`server-state-${entry.online ? "online" : "offline"}`}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: entry.online ? "var(--success)" : "var(--text-faint)" }}
      />
      {!entry.online && t("linkedServers.down")}
    </span>
  );
}

interface Props {
  /** All servers across all networks (pre-fetched by the sidebar). */
  servers: ServerEntry[];
}

export function ServerSelector({ servers }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Active server = URL param (strict: false so it works on any nested route).
  // Slug routes (phase 4a) put the slug in the param, old links the id — match both.
  const params = useParams({ strict: false }) as {
    networkId?: string;
    serverId?: string;
  };
  // Routes without a serverId param (settings, credits…) fall back to the
  // persisted selection so the selector and the project list stay coherent.
  const storedServerId = useServersStore((s) => s.activeServerId);
  const activeServerId = params.serverId ?? storedServerId ?? null;

  // Server slugs are only unique per network — when the URL carries a network
  // param (id or slug), scope the match to it so "server" doesn't resolve to
  // another network's server of the same slug.
  const matchesNetwork = (s: ServerEntry) =>
    !params.networkId ||
    s.networkId === params.networkId ||
    (!!s.networkSlug && s.networkSlug === params.networkId);
  const active = servers.find(
    (s) =>
      matchesNetwork(s) &&
      (s.serverId === activeServerId || (s.serverSlug && s.serverSlug === activeServerId)),
  );

  const handleSelect = (entry: ServerEntry) => {
    setOpen(false);
    useSidebarStore.getState().close();
    useServersStore.getState().setActiveServerId(entry.serverId);
    useNetworksStore.getState().setActiveId(entry.networkId);
    navigate({
      to: "/networks/$networkId/servers/$serverId",
      params: { networkId: entry.networkId, serverId: entry.serverSlug ?? entry.serverId },
    });
  };

  if (servers.length === 0) return null;

  const displayLabel = active
    ? displayServerLabel({ id: active.serverId, label: active.serverLabel || null })
    : t("sidebar.selectServer");

  // Only show network-name suffix when servers span multiple networks
  const multiNetwork = new Set(servers.map((s) => s.networkId)).size > 1;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.serverLabel")}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[13.5px] font-medium text-[var(--text)]">
            <span className="truncate">{displayLabel}</span>
            {active && <ServerState entry={active} />}
          </span>
        </div>
        <ChevronDown
          data-testid="server-selector-caret"
          className="size-3.5 text-[var(--text-mut)]"
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-10 mt-1.5 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] p-1"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          {servers.map((entry) => (
            <button
              key={`${entry.networkId}:${entry.serverId}`}
              type="button"
              onClick={() => handleSelect(entry)}
              className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
            >
              <span className="text-[13px] text-[var(--text-mut)] hover:text-[var(--text)]">
                {displayServerLabel({ id: entry.serverId, label: entry.serverLabel || null })}
              </span>
              <ServerState entry={entry} />
              {multiNetwork && (
                <span className="ml-2 text-[11px] text-[var(--text-faint)]">
                  {entry.networkName}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
