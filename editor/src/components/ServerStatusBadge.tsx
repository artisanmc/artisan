import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { listPackBindings } from "@/lib/api/networks";

interface Props {
  networkId: string | null | undefined;
  packId: string;
}

/**
 * Compact "X online / Y offline" indicator for the workspace top bar.
 * Click → navigates to the workspace's "Servers" tab.
 *
 * Polls the bindings endpoint every 15 s so the dots reflect plugin
 * connect / disconnect events without requiring a manual refresh. Hidden
 * entirely when the pack has no bindings (nothing meaningful to show).
 */
export function ServerStatusBadge({ networkId, packId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [online, setOnline] = useState<number>(0);
  const [offline, setOffline] = useState<number>(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!networkId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const bindings = await listPackBindings(networkId, packId);
        if (cancelled) return;
        let on = 0;
        let off = 0;
        for (const b of bindings) {
          if (b.online) on++;
          else off++;
        }
        setOnline(on);
        setOffline(off);
        setLoaded(true);
      } catch {
        // Silent: a failed fetch shouldn't burn the top bar — the user can
        // still click through to the Servers tab to see the real error.
      }
    };
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [networkId, packId]);

  // Hide when nothing's loaded yet OR the pack has no bindings — the badge
  // is informational chrome, not a placeholder. The Servers tab itself
  // surfaces the "no bindings" empty state with a CTA.
  if (!loaded || (online === 0 && offline === 0)) return null;

  const goToServers = () => {
    navigate({
      to: "/workspace/$workspaceId",
      params: { workspaceId: packId },
      search: { tab: "servers" },
    });
  };

  return (
    <button
      type="button"
      onClick={goToServers}
      title={t("serverStatusBadge.title", { online, offline })}
      className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--raised)] px-3 font-mono text-[12px] text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
    >
      {online > 0 && (
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--sage)", boxShadow: "0 0 6px var(--sage)" }}
          />
          {online}
        </span>
      )}
      {offline > 0 && (
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--ink-faint)" }}
          />
          {offline}
        </span>
      )}
    </button>
  );
}
