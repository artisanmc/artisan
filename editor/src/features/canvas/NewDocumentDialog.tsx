import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { hasDocument } from "@/domain/documents";
import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { isKindSyncedOn, useServerDocumentKindsStore } from "@/state/serverDocumentKindsStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface NewDocumentDialogProps {
  projectId: ProjectId;
  /** A kind some module contributes (`documentKindContribution(kind)` is defined). */
  kind: string;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

/**
 * Creation of a Document of any contributed kind: an id, prefixed as the kind
 * declares, seeded by the contribution's `create`. The core kinds keep their own
 * dialogs (`NewMenuDialog`, …), which carry kind-specific fields.
 */
export function NewDocumentDialog({
  projectId,
  kind,
  open,
  position,
  onOpenChange,
}: NewDocumentDialogProps) {
  const [id, setId] = useState("");
  const { t } = useTranslation();
  const contribution = documentKindContribution(kind);
  const kindLabel = contribution
    ? t(contribution.label, { defaultValue: contribution.label })
    : kind;

  const trimmed = id.trim();
  const prefix = contribution?.idPrefix ?? "";
  const prefixedId = trimmed ? `${prefix}${trimmed}` : "";
  const conflict = useAccountStore((s) => {
    const project = s.account.projects.find((p) => p.id === projectId);
    return prefixedId !== "" && !!project && hasDocument(project, prefixedId);
  });
  // The editor's module knows the kind; does the server's? A kind the active server
  // does not register is written to a folder nothing there reads (W6).
  const synced = useServerDocumentKindsStore((s) => isKindSyncedOn(s, kind));

  const submit = () => {
    if (!trimmed || conflict || !contribution) return;
    const docId = useAccountStore
      .getState()
      .createDocument({ projectId, kind, id: prefixedId, position });
    useSelectionStore.getState().set([docId]);
    setId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("canvas.newDocumentDialogTitle", { kind: kindLabel })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus
            />
            {prefixedId && !conflict && (
              <span className="font-mono text-xs text-[var(--text-mut)]">
                {t("canvas.idPreviewLabel")}{" "}
                <span className="text-[var(--text-mut)]">{prefixedId}</span>
              </span>
            )}
            {conflict && (
              <span className="text-xs text-[var(--danger)]">{t("canvas.idConflict")}</span>
            )}
            {!synced && (
              <output className="text-xs text-[var(--warning)]">
                {t("canvas.kindNotSynced", { kind: kindLabel })}
              </output>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("canvas.cancel")}
            </Button>
            <Button onClick={submit} disabled={!trimmed || conflict || !contribution}>
              {t("canvas.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
