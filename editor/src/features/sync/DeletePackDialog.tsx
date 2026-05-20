import { useState } from "react";
import { useTranslation } from "react-i18next";

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
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h2 className="text-lg font-semibold mb-3">
          {t("sync.deletePackDialog.title", { name: packName })}
        </h2>
        <p className="text-sm text-gray-700 mb-2">
          {t("sync.deletePackDialog.warning")}
        </p>
        <p className="text-sm text-gray-700 mb-4">
          {t("sync.deletePackDialog.conflictWarning")}
        </p>
        <label className="block text-sm font-medium mb-1">
          {t("sync.deletePackDialog.typePrompt")}
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="border w-full px-3 py-2 rounded mb-4"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
          >
            {t("sync.deletePackDialog.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmEnabled}
            className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("sync.deletePackDialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
