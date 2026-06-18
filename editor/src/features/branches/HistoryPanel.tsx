import { useEffect, useState } from "react";
import { listCommits, type Commit } from "@/lib/api/branches";

interface Props { networkId: string; projectId: string; branch: string; }

export function HistoryPanel({ networkId, projectId, branch }: Props) {
  const [commits, setCommits] = useState<Commit[] | null>(null);

  useEffect(() => {
    listCommits(networkId, projectId, branch, 50).then(setCommits).catch(console.error);
  }, [networkId, projectId, branch]);

  if (commits === null)
    return <div className="px-1 py-1 text-[11.5px] text-[var(--text-mut)]">Loading…</div>;
  if (commits.length === 0)
    return <div className="px-1 py-1 text-[11.5px] text-[var(--text-mut)]">No commits yet</div>;

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {commits.slice(0, 8).map((c) => (
        <span
          key={c.id}
          className="flex h-7 shrink-0 items-center gap-2 rounded-[999px] border border-[var(--border-soft)] bg-[var(--surface-raised)] px-3 text-[11.5px] text-[var(--text-mut)]"
          title={`${c.id} · ${new Date(c.createdAt).toLocaleString()}`}
        >
          <span className="mono text-[10.5px] text-[var(--text-mut)]">{c.id.slice(0, 7)}</span>
          <span className="truncate max-w-[180px] text-[var(--text-mut)]">{c.message || "(no message)"}</span>
        </span>
      ))}
    </div>
  );
}
