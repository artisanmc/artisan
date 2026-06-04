import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface NewDialogDialogProps {
  packId: PackId;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

export function NewDialogDialog({ packId, open, position, onOpenChange }: NewDialogDialogProps) {
  const [id, setId] = useState("");
  const { t } = useTranslation();

  const existingIdsStr = useAccountStore((s) => {
    const pack = s.account.packs.find((p) => p.id === packId);
    if (!pack) return "";
    return [
      ...pack.dialogs.map((d) => d.id),
      ...pack.menus.map((m) => m.id),
      ...pack.commands.map((c) => c.id),
    ].join(",");
  });
  const existingIds = new Set(existingIdsStr ? existingIdsStr.split(",") : []);

  const trimmed = id.trim();
  const prefixedId = trimmed ? `dialog_${trimmed}` : "";
  const conflict = prefixedId !== "" && existingIds.has(prefixedId);

  const submit = () => {
    if (!trimmed || conflict) return;
    const dialogId = useAccountStore.getState().createDialog({ packId, id: prefixedId, position });
    useSelectionStore.getState().set([dialogId]);
    setId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("canvas.newDialogDialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Input
              placeholder="confirm_buy"
              value={id}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              autoFocus
            />
            {prefixedId && !conflict && (
              <span className="font-mono text-xs text-[var(--text-mut)]">
                {t("canvas.idPreviewLabel")} <span className="text-[var(--text-mut)]">{prefixedId}</span>
              </span>
            )}
            {conflict && (
              <span className="text-xs text-[var(--danger)]">{t("canvas.idConflict")}</span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("canvas.cancel")}</Button>
            <Button onClick={submit} disabled={!trimmed || conflict}>{t("canvas.create")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
