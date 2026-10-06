import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import {
  type NetworkServersStatus,
  type ServerStatusEntry,
  getNetworkServersStatus,
  isPluginOutdated,
  updateServerPlugin,
} from "@/lib/api/networks";
import { useCallback, useEffect, useState } from "react";
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
export function ServerRow({
  s,
  lang,
  t,
  onUpdatePlugin,
}: {
  s: ServerStatusEntry;
  lang: string;
  t: TFn;
  onUpdatePlugin?: () => Promise<void>;
}) {
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const update = async () => {
    if (!onUpdatePlugin) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      await onUpdatePlugin();
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  };
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
      {isPluginOutdated(s) ? (
        <div className="pl-3.5 text-[11px] text-[var(--danger)]">
          {t("linkedServers.pluginOutdated")}
        </div>
      ) : null}
      {s.pluginUpdatePending ? (
        <div className="pl-3.5 text-[11px] text-[var(--text-mut)]">
          {t("linkedServers.pluginUpdatePending", { version: s.pluginUpdatePending })}
        </div>
      ) : s.pluginUpdateVersion && onUpdatePlugin ? (
        <div className="flex flex-col gap-1 pl-3.5 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-mut)]">
              {t("linkedServers.pluginUpdateAvailable", { version: s.pluginUpdateVersion })}
            </span>
            <Button size="sm" variant="primary" disabled={updating} onClick={update}>
              {t(updating ? "linkedServers.pluginUpdating" : "linkedServers.pluginUpdate")}
            </Button>
          </div>
          {updateError ? (
            <span className="text-[11px] text-[var(--danger)]">
              {t("linkedServers.pluginUpdateFailed", { error: updateError })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Status dot (beside the server in the breadcrumb) + dropdown listing every server key in the current network with
 * live online/offline state, last-seen time and last IP. Polls every 15s.
 * Seule action : installer la dernière version du plugin. Replaces the single-server ServerStatusBadge.
 */
export function LinkedServersDropdown({
  networkId,
  currentServerKeyId,
  downHint,
}: {
  networkId: string | null | undefined;
  currentServerKeyId?: string;
  /** Explication du hors-ligne du serveur courant, affichée en infobulle sur le badge. */
  downHint?: string;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<NetworkServersStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!networkId) return;
    try {
      setData(await getNetworkServersStatus(networkId, currentServerKeyId));
    } catch {
      /* silent — keep last known state */
    }
  }, [networkId, currentServerKeyId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

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

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        title={downHint ? undefined : t("linkedServers.trigger", { online, total })}
        aria-label={t("linkedServers.trigger", { online, total })}
        className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-[var(--surface-hover)]"
      >
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{
            background: up ? "var(--success)" : "var(--danger)",
            boxShadow: up ? "0 0 6px var(--success)" : "0 0 6px var(--danger)",
          }}
        />
        <span className="sr-only">{label}</span>
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {downHint ? <Tooltip content={downHint}>{trigger}</Tooltip> : trigger}
      {/* Le project ouvert vit sur le disque d'UN serveur : c'est celui-là, et
          lui seul, qui a quelque chose à dire ici. Lister tout le parc du network
          à cet endroit répondait à une question que personne ne se pose depuis
          cette page (ADR `server-disk-only-storage`). */}
      <DropdownMenuContent align="end" className="min-w-[16rem]">
        <DropdownMenuLabel>{t("linkedServers.serverTitle")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {current ? (
          <ServerRow
            s={current}
            lang={i18n.language}
            t={t}
            onUpdatePlugin={() => updateServerPlugin(networkId, current.id).then(refresh)}
          />
        ) : (
          <div className="px-2.5 py-2 text-[12px] text-[var(--text-faint)]">
            {t("linkedServers.empty")}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
