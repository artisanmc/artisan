import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isValidProjectFolderName } from "@/lib/projectFolderName";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ImportProjectResult, runImportZip } from "./runImportZip";

export function useProjectZipImport({
  importProject,
  onImported,
  onError,
  persistImport,
  destinationDescription,
}: {
  importProject: (input: { project: unknown }) => string;
  onImported: (result: ImportProjectResult) => void;
  onError: (error: Error) => void;
  persistImport?: (
    file: Blob,
    targetId?: string,
    options?: { overwrite: true },
  ) => Promise<ImportProjectResult>;
  destinationDescription?: string;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [pending, setPending] = useState<Blob | null>(null);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  /** Dossier déjà pris dans le network : on propose de renommer ou d'écraser. */
  const [taken, setTaken] = useState<string | null>(null);

  async function importFile(file: Blob, target?: string, confirmed = false, overwrite = false) {
    if (destinationDescription && !confirmed) {
      setPending(file);
      setTargetId("");
      setTaken(null);
      return;
    }
    setBusy(true);
    try {
      const result = await (persistImport
        ? overwrite
          ? persistImport(file, target, { overwrite: true })
          : persistImport(file, target)
        : runImportZip(file, importProject, target));
      setPending(null);
      setTaken(null);
      onImported(result);
    } catch (error) {
      if (error instanceof Error && error.message === "project_id_required") {
        setPending(file);
        setTargetId("");
      } else if (error instanceof Error && error.message === "destination_exists" && target) {
        setPending(file);
        setTaken(target);
        setTargetId(`${target}_2`);
      } else {
        onError(error instanceof Error ? error : new Error("import_failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setPending(null);
          setTaken(null);
        }
      }}
    >
      <DialogContent>
        <DialogTitle>
          {t("projectIdentity.importTitle", { defaultValue: "Import project" })}
        </DialogTitle>
        <DialogDescription>
          {destinationDescription ??
            t("projectIdentity.importDescription", {
              defaultValue: "This archive has no project folder. Choose the folder name to use.",
            })}
        </DialogDescription>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) void importFile(pending, targetId.trim(), true);
          }}
        >
          <label htmlFor={fieldId} className="field-label flex flex-col gap-2">
            {t("projectIdentity.folder", { defaultValue: "Project folder" })}
            <Input
              id={fieldId}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <p className="text-sm text-[var(--text-mut)]">
            {t("projectIdentity.folderHint", {
              defaultValue: "Use letters, numbers, underscores or hyphens (up to 128 characters).",
            })}
          </p>
          {taken && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--border)] p-3">
              <p className="text-sm text-[var(--text)]">
                {t("projectIdentity.importExists", { folder: taken })}
              </p>
              <p className="text-sm text-[var(--text-mut)]">
                {t("projectIdentity.importOverwriteHint")}
              </p>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  if (pending) void importFile(pending, taken, true, true);
                }}
              >
                {t("projectIdentity.importOverwrite", { folder: taken })}
              </Button>
            </div>
          )}
          <Button type="submit" disabled={busy || !isValidProjectFolderName(targetId.trim())}>
            {t("projectIdentity.importTitle", { defaultValue: "Import project" })}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
  return { importFile, dialog };
}
