import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus } from "lucide-react";
import { useSidebarStore } from "@/state/sidebarStore";
import { Link } from "@tanstack/react-router";
import { displayServerLabel } from "@/lib/serverLabel";

export interface ServerEntry {
  serverId: string;
  serverLabel: string;
  networkId: string;
  networkName: string;
}

interface Props {
  /** All servers across all networks (pre-fetched by the sidebar). */
  servers: ServerEntry[];
}

export function ServerSelector({ servers }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Active server = URL param (strict: false so it works on any nested route)
  const params = useParams({ strict: false }) as {
    networkId?: string;
    serverId?: string;
  };
  const activeServerId = params.serverId ?? null;

  const active = servers.find((s) => s.serverId === activeServerId);

  const handleSelect = (entry: ServerEntry) => {
    setOpen(false);
    useSidebarStore.getState().close();
    navigate({
      to: "/networks/$networkId/servers/$serverId",
      params: { networkId: entry.networkId, serverId: entry.serverId },
    });
  };

  if (servers.length === 0) {
    return (
      <Link
        to="/setup"
        className="flex w-full items-center justify-between rounded-[14px] border border-dashed border-[var(--border)] bg-transparent px-3 py-2.5 text-left transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)]"
      >
        <div className="flex flex-col">
          <span className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.serverLabel")}
          </span>
          <span className="mt-0.5 text-[13px] font-medium text-[var(--text-mut)]">
            {t("sidebar.noServers")}
          </span>
        </div>
        <Plus className="size-3.5 text-[var(--brand)]" />
      </Link>
    );
  }

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
        <div className="flex flex-col">
          <span className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.serverLabel")}
          </span>
          <span className="mt-0.5 text-[13.5px] font-medium text-[var(--text)]">{displayLabel}</span>
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
              {multiNetwork && (
                <span className="ml-2 text-[11px] text-[var(--text-faint)]">{entry.networkName}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
