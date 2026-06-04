import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listServerKeyHelloes, type ServerKeyHello } from "@/lib/api/networks";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  networkId: string;
  serverId: string;
}

export function ConnectionHistoryModal({ open, onOpenChange, networkId, serverId }: Props) {
  const { t, i18n } = useTranslation();
  const [helloes, setHelloes] = useState<ServerKeyHello[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHelloes(null);
    setError(false);
    listServerKeyHelloes(networkId, serverId)
      .then(setHelloes)
      .catch(() => setError(true));
  }, [open, networkId, serverId]);

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(i18n.language); } catch { return iso; }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("connectionHistoryModal.title")}</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          {error ? (
            <p className="text-[12px] text-[var(--text-faint)]">{t("connectionHistoryModal.error")}</p>
          ) : helloes === null ? (
            <p className="text-[12px] text-[var(--text-faint)]">{t("connectionHistoryModal.loading")}</p>
          ) : helloes.length === 0 ? (
            <p className="text-[12px] text-[var(--text-faint)]">{t("connectionHistoryModal.empty")}</p>
          ) : (
            <ul className="flex max-h-[50vh] flex-col gap-1 overflow-auto">
              {helloes.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-[11.5px] text-[var(--text-mut)]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="mono truncate text-[var(--text-mut)]">{h.ip}</span>
                    {h.rejectedReason && (
                      <span className="badge badge-danger shrink-0 text-[9.5px]">
                        {t(`networkDetail.helloRejected.${h.rejectedReason}`, h.rejectedReason)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {h.mcVersion && (
                      <span className="text-[10.5px] text-[var(--text-faint)]">MC {h.mcVersion}</span>
                    )}
                    <span className="text-[var(--text-mut)]">{fmt(h.helloAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
