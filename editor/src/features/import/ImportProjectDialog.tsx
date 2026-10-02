import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileDiff } from "@/components/ui/file-diff";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { allConflictsResolved, withChoice, withChoiceForRemaining } from "./importChoices";
import type { ImportChoice, ImportMode } from "./importMerge";
import {
  type ImportError,
  type ImportPreview,
  applyImportZip,
  prepareImportZip,
} from "./runImportZip";

interface ImportProjectDialogProps {
  networkId: string;
  serverKeyId: string | null;
  open: boolean;
  onClose: () => void;
  onImported?: (projectId: string, created: boolean) => void;
}

/**
 * Import d'un Project depuis un ZIP, **dans le brouillon** du Project serveur
 * (ADR `server-only-projects`, décision 4) : rien n'atteint le disque avant que
 * l'admin ne déploie. Les conflits avec l'instantané courant se tranchent
 * fichier par fichier, jamais en silence.
 */
export function ImportProjectDialog({
  networkId,
  serverKeyId,
  open,
  onClose,
  onImported,
}: ImportProjectDialogProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImportError | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({});
  const [applyToRest, setApplyToRest] = useState(false);

  const reset = () => {
    setFile(null);
    setMode("merge");
    setBusy(false);
    setError(null);
    setPreview(null);
    setChoices({});
    setApplyToRest(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const apply = async (target: ImportPreview, chosen: Record<string, ImportChoice>) => {
    setBusy(true);
    setError(null);
    const result = await applyImportZip(target, chosen);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    onImported?.(result.projectId, result.created);
  };

  const prepare = async () => {
    if (!file || !serverKeyId) return;
    setBusy(true);
    setError(null);
    const result = await prepareImportZip(file, { networkId, serverId: serverKeyId }, mode);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.preview.diff.conflicts.length === 0) {
      await apply(result.preview, {});
      return;
    }
    setPreview(result.preview);
    setChoices({});
    setApplyToRest(false);
  };

  const conflicts = preview?.diff.conflicts ?? [];
  const serverOnly = preview?.diff.serverOnly ?? [];
  const additions = preview?.diff.additions ?? [];

  const choose = (index: number, path: string, choice: ImportChoice) => {
    setChoices((current) =>
      applyToRest
        ? withChoiceForRemaining(current, conflicts, index, choice)
        : withChoice(current, path, choice),
    );
  };

  const ready = allConflictsResolved(choices, conflicts);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {preview ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("importProject.conflictsTitle")}</DialogTitle>
              <DialogDescription>
                {t("importProject.conflictsDescription", {
                  count: conflicts.length,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 text-[12px] text-[var(--text-mut)]">
              <span>{t("importProject.summaryAdditions", { count: additions.length })}</span>
              {mode === "overwrite" && serverOnly.length > 0 && (
                <span className="text-[var(--danger)]">
                  {t("importProject.summaryDeletions", { count: serverOnly.length })}
                </span>
              )}
              {mode === "merge" && serverOnly.length > 0 && (
                <span>{t("importProject.summaryKept", { count: serverOnly.length })}</span>
              )}
            </div>

            <div className="flex flex-col gap-5">
              {conflicts.map((conflict, index) => (
                <div key={conflict.path} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="mono truncate text-[12.5px] text-[var(--text)]">
                      {conflict.path}
                    </span>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        variant={choices[conflict.path] === "import" ? "primary" : "outline"}
                        onClick={() => choose(index, conflict.path, "import")}
                      >
                        {t("importProject.keepImport")}
                      </Button>
                      <Button
                        size="sm"
                        variant={choices[conflict.path] === "server" ? "primary" : "outline"}
                        onClick={() => choose(index, conflict.path, "server")}
                      >
                        {t("importProject.keepServer")}
                      </Button>
                    </div>
                  </div>
                  {conflict.kind === "text" ? (
                    <FileDiff
                      before={conflict.server}
                      after={preview.input.files[conflict.path] ?? null}
                      beforeLabel={t("importProject.serverLabel")}
                      afterLabel={t("importProject.importLabel")}
                    />
                  ) : (
                    <p className="text-[12px] text-[var(--text-mut)]">
                      {t("importProject.binaryConflict")}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[13px] text-[var(--text)]">
              <Checkbox
                id="import-apply-to-rest"
                checked={applyToRest}
                onCheckedChange={setApplyToRest}
              />
              <label htmlFor="import-apply-to-rest" className="cursor-pointer">
                {t("importProject.applyToRest")}
              </label>
            </div>

            {error && (
              <div className="text-xs text-[var(--danger)]">
                {t(`importProject.errors.${error}`, {
                  defaultValue: t("importProject.errors.unknown"),
                })}
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={close}>
                {t("importProject.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={busy || !ready}
                onClick={() => preview && apply(preview, choices)}
              >
                {busy ? "…" : t("importProject.apply")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("importProject.title")}</DialogTitle>
              <DialogDescription>{t("importProject.description")}</DialogDescription>
            </DialogHeader>

            <FileDropzone
              file={file}
              onFile={setFile}
              accept=".zip"
              label={t("importProject.fileLabel")}
              prompt={t("importProject.dropPrompt")}
              hint={t("importProject.dropHint")}
              clearLabel={t("importProject.clear")}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="field-label">{t("importProject.modeLabel")}</legend>
              {(["merge", "overwrite"] as const).map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-2 text-[13px] text-[var(--text)]"
                >
                  <input
                    type="radio"
                    name="import-mode"
                    className="mt-0.5 accent-[var(--brand)]"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <span className="flex flex-col">
                    <span>{t(`importProject.mode.${value}.title`)}</span>
                    <span className="text-[11.5px] text-[var(--text-mut)]">
                      {t(`importProject.mode.${value}.hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {error && (
              <div className="text-xs text-[var(--danger)]">
                {t(`importProject.errors.${error}`, {
                  defaultValue: t("importProject.errors.unknown"),
                })}
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={close}>
                {t("importProject.cancel")}
              </Button>
              <Button variant="primary" disabled={busy || !file || !serverKeyId} onClick={prepare}>
                {busy ? "…" : t("importProject.submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
