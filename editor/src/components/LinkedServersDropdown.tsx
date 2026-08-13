import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  getNetworkServersStatus,
  type NetworkServersStatus,
  type ServerStatusEntry,
} from "@/lib/api/networks";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const POLL_MS = 15_000;

type TFn = ReturnType<typeof useTranslation>["t"];

/** Relative "x ago" using the active editor language. Exported for unit tests. */
export function relTime(iso: string, lang: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const mins = Math.round(diffMs / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

/** One server row in the dropdown. Exported so it can be unit-tested without
 * opening the (portalled) Radix menu. */
export function ServerRow({ s, lang, t }: { s: ServerStatusEntry; lang: string; t: TFn }) {
  return (
    <div className="flex flex-col gap-0.5 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: s.online ? "var(--success)" : "var(--text-faint)",
            boxShadow: s.online ? "0 0 6px var(--success)" : "none",
          }}
        />
        <span className="truncate text-[13px] text-[var(--text)]">
          {s.label ?? s.id.slice(0, 8)}
        </span>
        {s.isCurrent ? <Badge variant="sage">{t("linkedServers.current")}</Badge> : null}
      </div>
      <div className="pl-3.5 font-mono text-[11px] text-[var(--text-faint)]">
        {s.online ? (
          <>
            {t("linkedServers.online")}
            {s.lastSeenIp ? ` · ${s.lastSeenIp}` : ""}
            {s.lastMcVersion ? ` · ${s.lastMcVersion}` : ""}
          </>
        ) : s.lastSeenAt ? (
          <>
            {t("linkedServers.lastSeen", { when: relTime(s.lastSeenAt, lang) })}
            {s.lastSeenIp ? ` · ${s.lastSeenIp}` : ""}
          </>
        ) : (
          t("linkedServers.neverConnected")
        )}
      </div>
    </div>
  );
}

/**
 * Topbar badge + dropdown listing every server key in the current network with
 * live online/offline state, last-seen time and last IP. Polls every 15s.
 * Read-only (no actions). Replaces the single-server ServerStatusBadge.
 */
export function LinkedServersDropdown({
  networkId,
  currentServerKeyId,
}: {
  networkId: string | null | undefined;
  currentServerKeyId?: string;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<NetworkServersStatus | null>(null);

  useEffect(() => {
    if (!networkId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const d = await getNetworkServersStatus(networkId, currentServerKeyId);
        if (!cancelled) setData(d);
      } catch {
        /* silent — keep last known state */
      }
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [networkId, currentServerKeyId]);

  if (!networkId || data === null) return null;

  const { online, total } = data;
  // Ce qui compte sur cette page, c'est l'état du serveur qui PORTE le project
  // ouvert : son contenu vit sur son disque, donc il conditionne tout (ADR
  // `server-disk-only-storage`). L'agrégat réseau ne disait rien de ça — « 2/2 »
  // pouvait s'afficher pendant que TON serveur était le seul à manquer.
  // Le détail des autres serveurs reste dans le menu déroulant.
  const current = currentServerKeyId
    ? data.servers.find((s) => s.id === currentServerKeyId)
    : undefined;
  const up = current ? current.online : online > 0;
  const label = current
    ? t(current.online ? "linkedServers.up" : "linkedServers.down")
    : t("linkedServers.count", { online, total });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("linkedServers.trigger", { online, total })}
          aria-label={t("linkedServers.trigger", { online, total })}
          className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 font-mono text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: up ? "var(--success)" : "var(--danger)",
              boxShadow: up ? "0 0 6px var(--success)" : "0 0 6px var(--danger)",
            }}
          />
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[16rem]">
        <DropdownMenuLabel>{t("linkedServers.title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {total === 0 ? (
          <div className="px-2.5 py-2 text-[12px] text-[var(--text-faint)]">
            {t("linkedServers.empty")}
          </div>
        ) : (
          data.servers.map((s) => (
            <ServerRow key={s.id} s={s} lang={i18n.language} t={t} />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
