import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mergeBranches, type MergePlan } from "@/lib/api/branches";
import { MergeConflictModal } from "./MergeConflictModal";

interface Props {
  networkId: string;
  packId: string;
  sourceBranch: string;
  allBranches: string[];
}

export function MergeButton({ networkId, packId, sourceBranch, allBranches }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(() => allBranches.find((b) => b !== sourceBranch) ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictPlan, setConflictPlan] = useState<MergePlan | null>(null);

  const onStart = async () => {
    if (!target) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const plan = await mergeBranches(networkId, packId, sourceBranch, target, message || undefined);
      if (plan.kind === "already_merged") {
        setStatus("Already up to date");
      } else if (plan.kind === "fast_forward") {
        setStatus("Fast-forwarded — no conflicts");
      } else if (plan.kind === "auto") {
        // Auto-merge: we still need /resolve to commit. Open the modal in "preview" mode.
        setConflictPlan(plan);
        setOpen(false);
      } else {
        // Conflicts: open the resolver modal.
        setConflictPlan(plan);
        setOpen(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Merge…</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Merge {sourceBranch} into …</DialogTitle></DialogHeader>
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
            <Input
              placeholder="Optional commit message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {status && <div className="text-xs text-[var(--sage)]">{status}</div>}
            {error && <div className="text-xs text-[var(--brick)]">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={onStart} disabled={busy || !target}>Start merge</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {conflictPlan && (conflictPlan.kind === "auto" || conflictPlan.kind === "conflicts") && (
        <MergeConflictModal
          networkId={networkId}
          packId={packId}
          src={sourceBranch}
          dst={target}
          plan={conflictPlan}
          onResolved={() => { setConflictPlan(null); setStatus("Merged"); }}
          onCancel={() => setConflictPlan(null)}
        />
      )}
    </>
  );
}
