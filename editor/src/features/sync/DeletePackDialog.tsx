import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface DeletePackDialogProps {
  packName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Always open while mounted — the caller conditionally renders it. */
export function DeletePackDialog({ packName, onConfirm, onCancel }: DeletePackDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const confirmEnabled = typed === packName;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
              <AlertTriangle className="size-[18px]" />
            </span>
            <DialogTitle>{t("sync.deletePackDialog.title", { name: packName })}</DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-[13.5px] leading-relaxed text-[var(--text-mut)]">
          {t("sync.deletePackDialog.warning")}
        </p>
        <p className="text-[12.5px] leading-relaxed text-[var(--text-mut)]">
          {t("sync.deletePackDialog.conflictWarning")}
        </p>
        <FormField label={t("sync.deletePackDialog.typePrompt")}>
          <Input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </FormField>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("sync.deletePackDialog.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!confirmEnabled}>
            {t("sync.deletePackDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
