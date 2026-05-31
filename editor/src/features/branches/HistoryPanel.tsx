import { useEffect, useState } from "react";
import { listCommits, type Commit } from "@/lib/api/branches";

interface Props { networkId: string; packId: string; branch: string; }

export function HistoryPanel({ networkId, packId, branch }: Props) {
  const [commits, setCommits] = useState<Commit[] | null>(null);

  useEffect(() => {
    listCommits(networkId, packId, branch, 50).then(setCommits).catch(console.error);
  }, [networkId, packId, branch]);

  if (commits === null)
    return <div className="px-1 py-1 text-[11.5px] text-[var(--ink-mut)]">Loading…</div>;
  if (commits.length === 0)
    return <div className="px-1 py-1 text-[11.5px] text-[var(--ink-mut)]">No commits yet</div>;

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {commits.slice(0, 8).map((c) => (
        <span
          key={c.id}
          className="flex h-7 shrink-0 items-center gap-2 rounded-[999px] border border-[var(--line-soft)] bg-[var(--raised)] px-3 text-[11.5px] text-[var(--ink-mut)]"
          title={`${c.id} · ${new Date(c.createdAt).toLocaleString()}`}
        >
          <span className="mono text-[10.5px] text-[var(--sand)]">{c.id.slice(0, 7)}</span>
          <span className="truncate max-w-[180px] text-[var(--ink-2)]">{c.message || "(no message)"}</span>
        </span>
      ))}
    </div>
  );
}
