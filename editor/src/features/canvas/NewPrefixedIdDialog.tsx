import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectId } from "@/domain/types";
import { useSelectionStore } from "@/state/selectionStore";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentIdTaken } from "./newDocumentId";

interface NewPrefixedIdDialogProps {
  projectId: ProjectId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Prepended to what the user types (`menu_`, `dialog_`, a contribution's `idPrefix`). */
  prefix: string;
  placeholder?: string;
  /** False blocks the creation (e.g. no contribution for the kind). */
  canCreate?: boolean;
  /** Creates the Document under the free, prefixed id; returns the id to select. */
  onCreate: (id: string) => string;
  /** Extra notes under the field. */
  children?: ReactNode;
}

/**
 * The "new Document" dialog for kinds whose only field is an id: the typed id,
 * prefixed, refused when any Document of the project already holds it.
 */
export function NewPrefixedIdDialog({
  projectId,
  open,
  onOpenChange,
  title,
  prefix,
  placeholder,
  canCreate = true,
  onCreate,
  children,
}: NewPrefixedIdDialogProps) {
  const [id, setId] = useState("");
  const { t } = useTranslation();

  const trimmed = id.trim();
  const prefixedId = trimmed ? `${prefix}${trimmed}` : "";
  const conflict = useDocumentIdTaken(projectId, prefixedId);

  const submit = () => {
    if (!trimmed || conflict || !canCreate) return;
    const created = onCreate(prefixedId);
    useSelectionStore.getState().set([created]);
    setId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Input
              placeholder={placeholder}
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
            {children}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("canvas.cancel")}
            </Button>
            <Button onClick={submit} disabled={!trimmed || conflict || !canCreate}>
              {t("canvas.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
