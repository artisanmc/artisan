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
    <div className="relative inline-flex items-center">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-3 size-[13px] text-[var(--sage)]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M6 9v6" />
        <circle cx="18" cy="6" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
      <select
        className="select mono h-[34px] py-0 pl-[34px] pr-7 text-[12.5px]"
        value={currentBranch ?? ""}
        onChange={(e) => setCurrentBranch(e.target.value)}
      >
        {branches.map((b) => (
          <option key={b.name} value={b.name}>{b.name}</option>
        ))}
      </select>
    </div>
  );
}
