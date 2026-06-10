import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { slugify } from "@/lib/slug";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Current values — the form is prefilled from them on open. */
  server: { id: string; label: string | null; slug?: string } | null;
  /** Throws with the backend error code ("slug_taken"…) on failure. */
  onSave: (updates: { label: string; slug: string }) => Promise<void>;
}

export function EditServerModal({ open, onOpenChange, server, onSave }: Props) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && server) {
      setLabel(server.label ?? "");
      setSlug(server.slug ?? "");
      setError(null);
    }
  }, [open, server]);

  const submit = async () => {
    const trimmed = label.trim();
    const canonical = slugify(slug || trimmed, "server");
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave({ label: trimmed, slug: canonical });
      onOpenChange(false);
    } catch (e) {
      const code = e instanceof Error ? e.message : "unknown";
      setError(
        code === "slug_taken" ? t("editServerModal.slugTaken") : t("editServerModal.saveFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("editServerModal.title")}</DialogTitle>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--text-mut)]">{t("editServerModal.labelField")}</span>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </label>
        <label className="mt-2 flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--text-mut)]">{t("editServerModal.slugField")}</span>
          <input
            className="input mono"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={() => setSlug((s) => (s.trim() ? slugify(s) : s))}
          />
          <span className="text-[11px] text-[var(--text-faint)]">
            {t("editServerModal.slugHint")}
          </span>
        </label>
        {error && <p className="mt-2 text-[12px] text-[var(--danger)]">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={() => onOpenChange(false)}>
            {t("editServerModal.cancel")}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={submitting || label.trim().length === 0}
          >
            {submitting ? t("editServerModal.saving") : t("editServerModal.save")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
