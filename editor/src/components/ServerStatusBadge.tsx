import { getServerStatus } from "@/lib/api/networks";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  networkId: string | null | undefined;
  serverKeyId: string;
  projectId: string;
}

export function ServerStatusBadge({ networkId, serverKeyId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    // Both ids required — a pack loaded from the user API may carry no
    // serverKeyId; an empty segment would hit /server-keys//status (404).
    if (!networkId || !serverKeyId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await getServerStatus(networkId, serverKeyId);
        if (!cancelled) setOnline(s.online);
      } catch {
        /* silent */
      }
    };
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [networkId, serverKeyId]);

  if (online === null) return null;

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/networks/$networkId", params: { networkId: networkId! } })}
      title={t(online ? "serverStatusBadge.titleOnline" : "serverStatusBadge.titleOffline")}
      className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 font-mono text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: online ? "var(--success)" : "var(--text-faint)",
          boxShadow: online ? "0 0 6px var(--success)" : "none",
        }}
      />
      {online ? t("serverStatusBadge.online") : t("serverStatusBadge.offline")}
    </button>
  );
}
