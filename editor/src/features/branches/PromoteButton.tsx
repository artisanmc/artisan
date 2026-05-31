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
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Promote</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Promote {sourceBranch} →</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Target branch</span>
              <select
                aria-label="target branch"
                className="select"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">— choose —</option>
                {allBranches.filter((b) => b !== sourceBranch).map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            {error && <div className="text-xs text-[var(--brick)]">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={onConfirm} disabled={busy || !target}>Confirm</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
