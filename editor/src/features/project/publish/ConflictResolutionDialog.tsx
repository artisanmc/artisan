import { Collapsible } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileDiff } from "@/components/ui/file-diff";
import type { ConflictChoice } from "@/features/project/resolveConflicts";
import { useTranslation } from "react-i18next";
import { type ConflictState, allConflictsChosen } from "./publishFlow";

/** The per-file resolution modal: open while `conflict.conflicts` is not empty. */
export function ConflictResolutionDialog({
  conflict,
  onChoose,
  onClose,
  onApply,
}: {
  conflict: ConflictState;
  onChoose: (path: string, choice: ConflictChoice) => void;
  onClose: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const { source, conflicts, tree, diskFiles, choices } = conflict;
  return (
    <Dialog open={conflicts.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto">
        <DialogHeader className="pr-6">
          <DialogTitle>
            {t(source === "draft" ? "save.conflictDraftTitle" : "save.conflictTitle")}
          </DialogTitle>
          <DialogDescription>
            {t(
              source === "draft"
                ? "save.conflictDraftBody"
                : source === "open"
                  ? "save.conflictOpenBody"
                  : "save.conflictBody",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {conflicts.map((c, index) => (
            <div key={c.path} className="card min-w-0 flex flex-col gap-2 p-3">
              <Collapsible
                defaultOpen={index === 0}
                title={<code className="break-all text-xs">{c.path}</code>}
              >
                <FileDiff before={c.disk} after={tree[c.path] ?? null} />
              </Collapsible>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={choices[c.path] === "mine"}
                  className={
                    choices[c.path] === "mine" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"
                  }
                  onClick={() => onChoose(c.path, "mine")}
                >
                  {t("save.conflictKeepMine")}
                </button>
                <button
                  type="button"
                  aria-pressed={choices[c.path] === "disk"}
                  className={
                    choices[c.path] === "disk" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"
                  }
                  onClick={() => onChoose(c.path, "disk")}
                >
                  {t(source === "draft" ? "save.conflictTakeOther" : "save.conflictTakeServer")}
                </button>
              </div>
              {c.disk === null ? (
                <>
                  <p className="text-xs text-[var(--text-faint)]">
                    {t("save.conflictDeletedOnDisk")}
                  </p>
                  {/* A manual rename looks like a deletion: without seeing what the
                      folder holds now, "keep mine" recreates the old file next to the new one. */}
                  {diskFiles.length > 0 ? (
                    <p className="text-xs text-[var(--text-faint)]">
                      {t("save.conflictDiskNow")}{" "}
                      <span className="font-mono">
                        {diskFiles
                          .filter((p) => p.split("/")[0] === c.path.split("/")[0])
                          .join(" · ") || t("save.conflictDiskEmpty")}
                      </span>
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            {t("save.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!allConflictsChosen(conflict)}
            onClick={onApply}
          >
            {t("save.conflictApply")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
