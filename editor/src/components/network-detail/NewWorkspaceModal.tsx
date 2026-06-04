import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  serverLabel: string;
  onCreate: (input: { name: string; description?: string }) => Promise<void> | void;
}

export function NewWorkspaceModal({ open, onOpenChange, serverLabel, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: trimmed,
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("newWorkspaceModal.title", { server: serverLabel })}
          </DialogTitle>
        </DialogHeader>
        <label className="mt-2 flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--text-mut)]">{t("newWorkspaceModal.nameField")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="mt-2 flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--text-mut)]">{t("newWorkspaceModal.descriptionField")}</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={() => onOpenChange(false)}>
            {t("newWorkspaceModal.cancel")}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={submitting || name.trim().length === 0}
          >
            {submitting ? t("newWorkspaceModal.creating") : t("newWorkspaceModal.create")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
