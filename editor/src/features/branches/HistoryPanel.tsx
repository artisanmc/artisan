import { useEffect, useState } from "react";
import { listCommits, type Commit } from "@/lib/api/branches";

interface Props { networkId: string; packId: string; branch: string; }

export function HistoryPanel({ networkId, packId, branch }: Props) {
  const [commits, setCommits] = useState<Commit[] | null>(null);

  useEffect(() => {
    listCommits(networkId, packId, branch, 50).then(setCommits).catch(console.error);
  }, [networkId, packId, branch]);

  if (commits === null) return <div className="p-2 text-xs text-muted-foreground">Loading…</div>;
  if (commits.length === 0) return <div className="p-2 text-xs text-muted-foreground">No commits yet</div>;

  return (
    <ul className="flex flex-col gap-1 p-2 text-xs">
      {commits.map((c) => (
        <li key={c.id} className="border-l-2 border-zinc-700 pl-2">
          <div className="font-medium">{c.message || "(no message)"}</div>
          <div className="text-muted-foreground font-mono text-[10px]">
            {c.id.slice(0, 12)} · {new Date(c.createdAt).toLocaleString()}
          </div>
        </li>
      ))}
    </ul>
  );
}
