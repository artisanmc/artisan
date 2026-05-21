import { useEffect } from "react";
import { useBranchesStore } from "@/state/branchesStore";
import { listBranches } from "@/lib/api/branches";

interface Props { networkId: string; packId: string; }

export function BranchSwitcher({ networkId, packId }: Props) {
  const branches = useBranchesStore((s) => s.branches);
  const currentBranch = useBranchesStore((s) => s.currentBranch);
  const setBranches = useBranchesStore((s) => s.setBranches);
  const setCurrentBranch = useBranchesStore((s) => s.setCurrentBranch);

  useEffect(() => {
    listBranches(networkId, packId).then(setBranches).catch(console.error);
  }, [networkId, packId, setBranches]);

  if (branches.length === 0) return null;
  return (
    <select
      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-mono"
      value={currentBranch ?? ""}
      onChange={(e) => setCurrentBranch(e.target.value)}
    >
      {branches.map((b) => (
        <option key={b.name} value={b.name}>{b.name}</option>
      ))}
    </select>
  );
}
