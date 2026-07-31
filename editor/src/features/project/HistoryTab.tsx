import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Project } from "@/domain/types";
import { listCommits, getCommitContent, type Commit } from "@/lib/api/branches";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useAccountStore } from "@/state/accountStore";

interface Props { project: Project; networkId: string; }

/**
 * Order commits newest-first (HEAD → root). We walk parent links from the tip
 * rather than trusting `createdAt` desc: commits minted in the same request
 * (e.g. initial commit + first deploy) can share a timestamp, and a plain
 * timestamp sort then leaves them in arbitrary order. The tip is the commit no
 * other commit lists as a parent; ties/orphans fall back to `createdAt` desc.
 */
function orderHeadFirst(commits: Commit[]): Commit[] {
  if (commits.length <= 1) return commits;
  const byId = new Map(commits.map((c) => [c.id, c]));
  const isParent = new Set<string>();
  for (const c of commits) if (c.parentId) isParent.add(c.parentId);
  const tips = commits
    .filter((c) => !isParent.has(c.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const ordered: Commit[] = [];
  const seen = new Set<string>();
  for (const tip of tips) {
    let cur: Commit | undefined = tip;
    while (cur && !seen.has(cur.id)) {
      ordered.push(cur);
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  // Leftovers (cycles / detached commits) — keep them visible, newest first.
  for (const c of commits) if (!seen.has(c.id)) ordered.push(c);
  return ordered;
}

export function HistoryTab({ project, networkId }: Props) {
  const { t, i18n } = useTranslation();
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const replaceProject = useAccountStore((s) => s.replaceProject);

  useEffect(() => {
    listCommits(networkId, project.id, "main")
      .then((list) => setCommits(orderHeadFirst(list)))
      .catch(() => setCommits([]));
  }, [networkId, project.id]);

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(i18n.language); } catch { return iso; }
  };

  const handleRestore = async (commitId: string) => {
    setRestoring(commitId);
    try {
      const head = await getCommitContent(networkId, project.id, commitId);
      if (!head) {
        toast.error(t("historyTab.restoreFailed"));
        return;
      }
      // Files are the canonical commit content — parse them back into a Project.
      const restored: Project = projectFromFiles(project.id, head.files, {
        name: project.name,
        serverKeyId: project.serverKeyId,
      });
      replaceProject(restored);
      toast.success(t("historyTab.restored"));
    } catch {
      toast.error(t("historyTab.restoreFailed"));
    } finally {
      setRestoring(null);
    }
  };

  if (commits === null) {
    return <p className="text-[12px] text-[var(--text-faint)]">{t("historyTab.loading")}</p>;
  }
  if (commits.length === 0) {
    return <p className="text-[12px] text-[var(--text-faint)]">{t("historyTab.empty")}</p>;
  }

  const headId = commits[0]?.id;

  return (
    <div className="flex flex-col gap-3">
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
