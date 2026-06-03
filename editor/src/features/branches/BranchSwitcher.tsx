import { useEffect } from "react";
import { GitBranch } from "lucide-react";
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
  // Flex shell holds the border + background; the native <select> sits inside
  // as transparent, so the icon and the selected-value text live in the same
  // flex row — no absolute positioning hacks, no clash with the browser's
  // native select padding quirks.
  return (
    <label className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--raised)] pl-3 pr-2 hover:border-[var(--line-strong)] focus-within:border-[var(--terra-line)]">
      <GitBranch className="size-[13px] shrink-0 text-[var(--sage)]" />
      <select
        className="mono h-full appearance-none bg-transparent pr-3 font-mono text-[12.5px] text-[var(--ink-2)] outline-none"
        value={currentBranch ?? ""}
        onChange={(e) => setCurrentBranch(e.target.value)}
      >
        {branches.map((b) => (
          <option key={b.name} value={b.name}>{b.name}</option>
        ))}
      </select>
    </label>
  );
}
