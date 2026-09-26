import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreate: (label: string) => Promise<void> | void;
}

export function NewServerModal({ open, onOpenChange, onCreate }: Props) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setLabel("");
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "server_limit_reached" ? "limit" : "generic");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("newServerModal.title")}</DialogTitle>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--text-mut)]">{t("newServerModal.labelField")}</span>
          <input
            className="input"
            placeholder={t("newServerModal.labelPlaceholder")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </label>
        {error && <p role="alert" className="text-sm text-[var(--danger)]">{t(`newServerModal.${error}`)}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={() => onOpenChange(false)}>
            {t("newServerModal.cancel")}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={submitting || label.trim().length === 0}
          >
            {submitting ? t("newServerModal.creating") : t("newServerModal.create")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
