import { ChangeList, type ChangeSet } from "@/components/ui/change-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

/** Last look at what a deployment writes to the server disk, before anything is sent. */
export function DeployReviewDialog({
  changes,
  onConfirm,
  onCancel,
}: {
  changes: ChangeSet | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={changes !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl flex-col">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("deploy.reviewTitle")}</DialogTitle>
          <DialogDescription>{t("deploy.reviewBody")}</DialogDescription>
        </DialogHeader>
        {changes && (
          <ChangeList
            {...changes}
            beforeLabel={t("deploy.server")}
            afterLabel={t("deploy.draft")}
            className="min-h-0 flex-1 overflow-y-auto"
          />
        )}
        <DialogFooter>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            {t("save.cancel")}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onConfirm}>
            {t("deploy.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
