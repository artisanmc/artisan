import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveMerge, type Conflict, type MergePlan } from "@/lib/api/branches";

interface Props {
  networkId: string;
  packId: string;
  src: string;
  dst: string;
  plan: Extract<MergePlan, { kind: "auto" | "conflicts" }>;
  onResolved: (mergeCommitId: string) => void;
  onCancel: () => void;
}

function previewItem(value: unknown): string {
  if (value === null) return "(deleted)";
  if (typeof value === "object" && value !== null && "name" in (value as object)) {
    return String((value as { name: string }).name);
  }
  return JSON.stringify(value).slice(0, 60);
}

export function MergeConflictModal({
  networkId, packId, src, dst, plan, onResolved, onCancel,
}: Props) {
  const [resolutions, setResolutions] = useState<Record<string, "src" | "dst">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allResolved = useMemo(
    () => plan.conflicts.every((c) => resolutions[c.conflictKey] !== undefined),
    [plan.conflicts, resolutions],
  );

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      // For MVP, the client derives filesJson elsewhere. Here we send the
      // mergedEditorJson and an empty filesJson — the editor's save flow will
      // re-derive on the next regular save. The merge commit itself carries
      // the editor state authoritative.
      const res = await resolveMerge(networkId, packId, src, dst, {
        resolutions,
        lcaCommitId: plan.lcaCommitId,
        srcCommitId: plan.srcCommitId,
        dstCommitId: plan.dstCommitId,
        mergedFilesJson: {},  // TODO(Phase 3.5): re-derive on client
        mergedEditorJson: plan.mergedEditorJson,
      });
      onResolved(res.head_commit_id);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {plan.conflicts.length === 0
              ? `Merge ${src} → ${dst} (no conflicts)`
              : `Resolve ${plan.conflicts.length} conflicts to merge ${src} → ${dst}`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {plan.conflicts.length === 0 && (
            <div className="text-xs text-[var(--sage)]">All changes auto-merged. Click Confirm to commit.</div>
          )}
          <ul className="flex flex-col gap-3 max-h-96 overflow-y-auto">
            {plan.conflicts.map((c: Conflict) => (
              <li key={c.conflictKey} className="border border-[var(--line-soft)] rounded p-2 text-xs">
                <div className="font-mono mb-1">{c.conflictKey}</div>
                <div className="text-muted-foreground mb-2">
                  {c.resolution === "modify-modify"
                    ? "Both sides modified this"
                    : c.srcValue === null
                      ? `${src} deleted this, ${dst} modified it`
                      : `${dst} deleted this, ${src} modified it`}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={c.conflictKey}
                      aria-label={`Use ${src}`}
                      checked={resolutions[c.conflictKey] === "src"}
                      onChange={() => setResolutions((r) => ({ ...r, [c.conflictKey]: "src" }))}
                    />
                    <span>Use {src}: {previewItem(c.srcValue)}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={c.conflictKey}
                      aria-label={`Use ${dst}`}
                      checked={resolutions[c.conflictKey] === "dst"}
                      onChange={() => setResolutions((r) => ({ ...r, [c.conflictKey]: "dst" }))}
                    />
                    <span>Use {dst}: {previewItem(c.dstValue)}</span>
                  </label>
                </div>
              </li>
            ))}
          </ul>
          {error && <div className="text-xs text-[var(--brick)]">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button
              onClick={onConfirm}
              disabled={busy || (plan.conflicts.length > 0 && !allResolved)}
            >
              Confirm merge
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
