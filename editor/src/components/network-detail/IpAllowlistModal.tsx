import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getServerKeyAllowlist, setServerKeyAllowlist } from "@/lib/api/networks";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  networkId: string;
  serverId: string;
}

export function IpAllowlistModal({ open, onOpenChange, networkId, serverId }: Props) {
  const { t } = useTranslation();
  const [ips, setIps] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) {
      setIps(null);
      setDraft("");
      setError(false);
      return;
    }
    setIps(null);
    setError(false);
    getServerKeyAllowlist(networkId, serverId)
      .then((result) => setIps(result ?? []))
      .catch(() => setError(true));
  }, [open, networkId, serverId]);

  const persist = (next: string[]) => {
    setServerKeyAllowlist(networkId, serverId, next.length > 0 ? next : null).catch(
      () => setError(true),
    );
  };

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed || !ips) return;
    if (ips.includes(trimmed)) {
      setDraft("");
      return;
    }
    const next = [...ips, trimmed];
    setIps(next);
    setDraft("");
    persist(next);
  };

  const handleRemove = (ip: string) => {
    if (!ips) return;
    const next = ips.filter((x) => x !== ip);
    setIps(next);
    persist(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("ipAllowlistModal.title")}</DialogTitle>
        </DialogHeader>
        <p className="mt-1 text-[12px] text-[var(--ink-faint)]">{t("ipAllowlistModal.help")}</p>
        <div className="mt-3">
          {error ? (
            <p className="text-[12px] text-[var(--ink-faint)]">{t("ipAllowlistModal.error")}</p>
          ) : ips === null ? (
            <p className="text-[12px] text-[var(--ink-faint)]">{t("ipAllowlistModal.loading")}</p>
          ) : ips.length === 0 ? (
            <p className="text-[12px] text-[var(--ink-faint)]">{t("ipAllowlistModal.empty")}</p>
          ) : (
            <ul className="mb-3 flex max-h-[30vh] flex-col gap-1 overflow-auto">
              {ips.map((ip) => (
                <li
                  key={ip}
                  className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-[12px] text-[var(--ink-2)]"
                >
                  <span className="mono truncate text-[var(--ink-mut)]">{ip}</span>
                  <button
                    className="btn btn-xs btn-ghost shrink-0 text-[11px]"
                    onClick={() => handleRemove(ip)}
                  >
                    {t("ipAllowlistModal.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {ips !== null && !error && (
            <div className="flex gap-2">
              <input
                className="input flex-1 text-[12px]"
                placeholder={t("ipAllowlistModal.placeholder")}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <button className="btn btn-sm btn-primary" onClick={handleAdd}>
                {t("ipAllowlistModal.add")}
              </button>
            </div>
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button className="btn btn-sm btn-ghost" onClick={() => onOpenChange(false)}>
            {t("ipAllowlistModal.close")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
