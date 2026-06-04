import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Pack } from "@/domain/types";
import { listCommits, getCommitContent, type Commit } from "@/lib/api/branches";
import { useAccountStore } from "@/state/accountStore";

interface Props { pack: Pack; networkId: string; }

export function HistoryTab({ pack, networkId }: Props) {
  const { t, i18n } = useTranslation();
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const replacePack = useAccountStore((s) => s.replacePack);

  useEffect(() => {
    listCommits(networkId, pack.id, "main").then(setCommits).catch(() => setCommits([]));
  }, [networkId, pack.id]);

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(i18n.language); } catch { return iso; }
  };

  const handleRestore = async (commitId: string) => {
    setRestoring(commitId);
    try {
      const head = await getCommitContent(networkId, pack.id, commitId);
      if (!head) {
        toast.error(t("historyTab.restoreFailed"));
        return;
      }
      const restored = { ...(head.editor as Partial<Pack>), id: pack.id, name: pack.name } as Pack;
      replacePack(restored);
      toast.success(t("historyTab.restored"));
    } catch {
      toast.error(t("historyTab.restoreFailed"));
    } finally {
      setRestoring(null);
    }
  };

  if (commits === null) {
    return <p className="p-4 text-[12px] text-[var(--text-faint)]">{t("historyTab.loading")}</p>;
  }
  if (commits.length === 0) {
    return <p className="p-4 text-[12px] text-[var(--text-faint)]">{t("historyTab.empty")}</p>;
  }

  const headId = commits[0]?.id;

  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="display text-[18px] text-[var(--text)]">{t("historyTab.title")}</h2>
      <ul className="flex flex-col gap-1.5">
        {commits.map((c, i) => {
          const isCurrent = i === commits.length - 1 && c.parentId === null;
          return (
            <li key={c.id} className="rounded-[8px] border border-[var(--border-soft)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[12.5px] text-[var(--text)]">
                    {c.id === headId && "▣ HEAD · "}{c.message}
                  </span>
                  <span className="text-[11px] text-[var(--text-faint)]">{fmt(c.createdAt)}</span>
                </div>
                {!isCurrent && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => handleRestore(c.id)}
                    disabled={restoring === c.id}
                  >
                    {restoring === c.id ? t("historyTab.restoring") : t("historyTab.restore")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
