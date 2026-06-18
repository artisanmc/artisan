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

export interface DeleteProjectDialogProps {
  projectName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Always open while mounted — the caller conditionally renders it. */
export function DeleteProjectDialog({ projectName, onConfirm, onCancel }: DeleteProjectDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const confirmEnabled = typed === projectName;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
              <AlertTriangle className="size-[18px]" />
            </span>
            <DialogTitle>{t("sync.deleteProjectDialog.title", { name: projectName })}</DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-[13.5px] leading-relaxed text-[var(--text-mut)]">
          {t("sync.deleteProjectDialog.warning")}
        </p>
        <p className="text-[12.5px] leading-relaxed text-[var(--text-mut)]">
          {t("sync.deleteProjectDialog.conflictWarning")}
        </p>
        <FormField label={t("sync.deleteProjectDialog.typePrompt")}>
          <Input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </FormField>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("sync.deleteProjectDialog.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!confirmEnabled}>
            {t("sync.deleteProjectDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
