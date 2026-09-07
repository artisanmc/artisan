import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  serverLabel: string;
  onCreate: (input: { name: string; description?: string }) => Promise<void> | void;
}

export function NewProjectModal({ open, onOpenChange, serverLabel, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
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
          <DialogTitle>{t("newProjectModal.title", { server: serverLabel })}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="mt-2 flex flex-col gap-1 text-[12px]">
            <span className="text-[var(--text-mut)]">{t("newProjectModal.nameField")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="mt-2 flex flex-col gap-1 text-[12px]">
            <span className="text-[var(--text-mut)]">{t("newProjectModal.descriptionField")}</span>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("newProjectModal.cancel")}
            </button>
            <button
              className="btn btn-sm btn-primary"
              type="submit"
              disabled={submitting || name.trim().length === 0}
            >
              {submitting ? t("newProjectModal.creating") : t("newProjectModal.create")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
