import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useServersStatus } from "@/components/useServersStatus";
import type { ServerSummary } from "@/lib/api/servers";
import { useTranslation } from "react-i18next";

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
}: {
  s: ServerSummary;
  lang: string;
  t: TFn;
}) {
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
      </div>
      <div className="pl-3.5 font-mono text-[11px] text-[var(--text-faint)]">
        {s.online ? (
          <>
            {t("linkedServers.online")}
            {s.minecraftVersion ? ` · ${s.minecraftVersion}` : ""}
          </>
        ) : s.lastSeenAt ? (
          t("linkedServers.lastSeen", { when: relTime(s.lastSeenAt, lang) })
        ) : (
          t("linkedServers.neverConnected")
        )}
      </div>
      {s.updateRequired ? (
        <div className="pl-3.5 text-[11px] text-[var(--danger)]">
          {t("linkedServers.updateRequired")}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Status dot (beside the server in the breadcrumb) + dropdown showing the
 * server holding the open project, with its live state and last-seen time.
 * Polls every 15s.
 */
export function LinkedServersDropdown({
  currentServerKeyId,
  downHint,
  offline = false,
}: {
  currentServerKeyId?: string;
  /** Why the current server is offline, shown as a tooltip on the badge. */
  downHint?: string;
  /** The open project could not reach its server: red at once, without waiting for the next poll. */
  offline?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useServersStatus();

  if (data === null) return null;

  const online = data.filter((s) => s.online).length;
  const total = data.length;
  // What matters here is the state of the server that HOLDS the open project:
  // its content lives on its disk, so it conditions everything (ADR
  // `server-disk-only-storage`). The hub aggregate could show "2/2" while
  // YOUR server was the only one missing.
  const current = currentServerKeyId ? data.find((s) => s.id === currentServerKeyId) : undefined;
  const up = !offline && (current ? current.online && !current.updateRequired : online > 0);
  const label = current
    ? t(
        current.updateRequired
          ? "linkedServers.updateRequired"
          : current.online
            ? "linkedServers.up"
            : "linkedServers.down",
      )
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
      {/* The open project lives on ONE server's disk: only that server has
          something to say here (ADR `server-disk-only-storage`). */}
      <DropdownMenuContent align="end" className="min-w-[16rem]">
        <DropdownMenuLabel>{t("linkedServers.serverTitle")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {current ? (
          <ServerRow s={current} lang={i18n.language} t={t} />
        ) : (
          <div className="px-2.5 py-2 text-[12px] text-[var(--text-faint)]">
            {t("linkedServers.empty")}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
