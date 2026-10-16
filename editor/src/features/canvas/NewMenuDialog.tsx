import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { NewPrefixedIdDialog } from "./NewPrefixedIdDialog";

interface NewMenuDialogProps {
  projectId: ProjectId;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

export function NewMenuDialog({ projectId, open, position, onOpenChange }: NewMenuDialogProps) {
  const { t } = useTranslation();
  return (
    <NewPrefixedIdDialog
      projectId={projectId}
      open={open}
      onOpenChange={onOpenChange}
      title={t("canvas.newMenuDialogTitle")}
      prefix="menu_"
      placeholder="my_menu"
      onCreate={(id) => useAccountStore.getState().createMenu({ projectId, id, position })}
    />
  );
}
