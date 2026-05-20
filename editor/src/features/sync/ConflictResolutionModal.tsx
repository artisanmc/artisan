import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConflictsStore } from "@/state/conflictsStore";
import { resolveConflict } from "@/lib/api/conflicts";

export interface ConflictResolutionModalProps {
  apiUrl: string;
  token: string;
  onClose: () => void;
}

export function ConflictResolutionModal({ apiUrl, token, onClose }: ConflictResolutionModalProps) {
  const { t } = useTranslation();
  const conflicts = useConflictsStore((s) => s.conflicts);
  const remove = useConflictsStore((s) => s.remove);

  // Auto-close when the last conflict is gone
  useEffect(() => {
    if (conflicts.length === 0) onClose();
  }, [conflicts.length, onClose]);

  async function handleResolve(id: string, choice: "editor" | "server") {
    try {
      await resolveConflict(apiUrl, token, id, choice);
      remove(id);
    } catch (err) {
      if ((err as Error).message === "already_resolved") {
        remove(id);
      }
    }
  }

  if (conflicts.length === 0) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{t("sync.modal.title")}</h2>
        <div className="space-y-6">
          {conflicts.map((cf) => {
            const isEmpty = cf.fileCount === 0;
            return (
              <div key={cf.id} className="border rounded p-4">
                <h3 className="font-medium mb-2">{cf.packId}</h3>
                <p className="text-sm text-gray-600 mb-3">
                  {t("sync.modal.modifiedAt", { date: new Date(cf.detectedAt).toLocaleString() })}
                </p>
                <div className="text-sm mb-3">
                  <div className="font-medium mb-1">{t("sync.modal.changesDetected")}</div>
                  <ul className="ml-4 list-disc text-gray-700">
                    {cf.diff.addedOnDisk.length > 0 && <li>+ {t("sync.modal.addedFiles", { count: cf.diff.addedOnDisk.length })}</li>}
                    {cf.diff.modifiedOnDisk.length > 0 && <li>~ {t("sync.modal.modifiedFiles", { count: cf.diff.modifiedOnDisk.length })}</li>}
                    {cf.diff.removedOnDisk.length > 0 && <li>- {t("sync.modal.removedFiles", { count: cf.diff.removedOnDisk.length })}</li>}
                  </ul>
                </div>
                {isEmpty && (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">
                    {t("sync.modal.emptyDiskWarning")}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleResolve(cf.id, "editor")}
                    className="border rounded p-3 text-left hover:bg-blue-50"
                  >
                    <div className="font-medium">{t("sync.modal.keepEditor")}</div>
                    <div className="text-xs text-gray-600">{t("sync.modal.keepEditorDesc")}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolve(cf.id, "server")}
                    className="border rounded p-3 text-left hover:bg-blue-50"
                  >
                    <div className="font-medium">{t("sync.modal.useServer")}</div>
                    <div className="text-xs text-gray-600">{t("sync.modal.useServerDesc")}</div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300">
            {t("sync.modal.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
