import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

export interface DeletePackDialogProps {
  packName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeletePackDialog({ packName, onConfirm, onCancel }: DeletePackDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const confirmEnabled = typed === packName;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/85 p-4 backdrop-blur-sm"
    >
      <div
        className="card w-full max-w-md p-7"
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
            <AlertTriangle className="size-[18px]" />
          </span>
          <h2
            className="display text-[20px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("sync.deletePackDialog.title", { name: packName })}
          </h2>
        </div>
        <p className="mb-2 text-[13.5px] leading-relaxed text-[var(--text-mut)]">
          {t("sync.deletePackDialog.warning")}
        </p>
        <p className="mb-5 text-[12.5px] leading-relaxed text-[var(--text-mut)]">
          {t("sync.deletePackDialog.conflictWarning")}
        </p>
        <label className="mb-1.5 block">
          <span className="field-label">{t("sync.deletePackDialog.typePrompt")}</span>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="input mt-1.5"
            autoFocus
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-ghost"
          >
            {t("sync.deletePackDialog.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmEnabled}
            className="btn"
            style={{
              background: "var(--danger)",
              color: "#fff",
              borderColor: "transparent",
              boxShadow: "0 8px 22px -12px rgba(232,87,88,.65)",
            }}
          >
            {t("sync.deletePackDialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
