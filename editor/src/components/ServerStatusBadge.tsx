import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getServerStatus } from "@/lib/api/networks";

interface Props {
  networkId: string | null | undefined;
  serverKeyId: string;
  packId: string;
}

export function ServerStatusBadge({ networkId, serverKeyId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (!networkId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await getServerStatus(networkId, serverKeyId);
        if (!cancelled) setOnline(s.online);
      } catch { /* silent */ }
    };
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [networkId, serverKeyId]);

  if (online === null) return null;

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/networks/$networkId", params: { networkId: networkId! } })}
      title={t(online ? "serverStatusBadge.titleOnline" : "serverStatusBadge.titleOffline")}
      className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--raised)] px-3 font-mono text-[12px] text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: online ? "var(--sage)" : "var(--ink-faint)",
          boxShadow: online ? "0 0 6px var(--sage)" : "none",
        }}
      />
      {online ? t("serverStatusBadge.online") : t("serverStatusBadge.offline")}
    </button>
  );
}
