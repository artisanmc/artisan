import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { NewPrefixedIdDialog } from "./NewPrefixedIdDialog";

interface NewDialogDialogProps {
  projectId: ProjectId;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

export function NewDialogDialog({ projectId, open, position, onOpenChange }: NewDialogDialogProps) {
  const { t } = useTranslation();
  return (
    <NewPrefixedIdDialog
      projectId={projectId}
      open={open}
      onOpenChange={onOpenChange}
      title={t("canvas.newDialogDialogTitle")}
      prefix="dialog_"
      placeholder="confirm_buy"
      onCreate={(id) => useAccountStore.getState().createDialog({ projectId, id, position })}
    />
  );
}
