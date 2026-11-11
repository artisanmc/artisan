import type { ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
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
      kind="dialog"
      open={open}
      onOpenChange={onOpenChange}
      title={t("canvas.newDialogDialogTitle")}
      prefix="dialog_"
      placeholder="confirm_buy"
      onCreate={(id) => useProjectsStore.getState().createDialog({ projectId, id, position })}
    />
  );
}
