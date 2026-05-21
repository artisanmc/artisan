import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { promoteBranch } from "@/lib/api/branches";

interface Props {
  networkId: string;
  packId: string;
  sourceBranch: string;
  allBranches: string[];
}

export function PromoteButton({ networkId, packId, sourceBranch, allBranches }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(() => allBranches.find((b) => b !== sourceBranch) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await promoteBranch(networkId, packId, sourceBranch, target);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Promote</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Promote {sourceBranch} →</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="text-xs">Target branch
              <select
                aria-label="target branch"
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">— choose —</option>
                {allBranches.filter((b) => b !== sourceBranch).map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            {error && <div className="text-xs text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={onConfirm} disabled={busy || !target}>Confirm</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
