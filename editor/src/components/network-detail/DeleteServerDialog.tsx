import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  server: { id: string; label: string; workspaceCount: number };
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteServerDialog({ server, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const canConfirm = typed === server.label;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deleteServerDialog.title", { label: server.label })}</DialogTitle>
        </DialogHeader>
        <p className="mt-2 text-[13px] text-[var(--text-mut)]">{t("deleteServerDialog.warning")}</p>
        {server.workspaceCount > 0 && (
          <p className="mt-2 text-[13px] text-[var(--danger)]">
            {t("deleteServerDialog.workspacesAlsoDeleted", { count: server.workspaceCount })}
          </p>
        )}
        <label className="mt-3 flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--text-mut)]">
            {t("deleteServerDialog.confirmLabel", { label: server.label })}
          </span>
          <input
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>
            {t("deleteServerDialog.cancel")}
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {t("deleteServerDialog.confirm")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
