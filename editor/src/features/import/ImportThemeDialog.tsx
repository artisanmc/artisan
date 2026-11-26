import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Input } from "@/components/ui/input";
import { KIT_FOLDER } from "@/lib/pack/kit";
import { THEME_COLORS_FILES, isThemeName } from "@/lib/pack/theme";
import type { ThemeArchive } from "@/lib/pack/themeArchive";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { importTheme, readThemeZip } from "./runImportTheme";

/**
 * Brings a theme from its archive (`<name>.theme.zip`, the export of a theme's page) onto the
 * server: a new folder of that name, with the archive's files. The theme arrives installed,
 * not in place. Nothing is written over a theme the server has: the name must be free.
 */
export function ImportThemeDialog({
  serverKeyId,
  taken = [],
  onImported,
}: {
  serverKeyId: string;
  /** The server's themes: a name among them is refused before the request. */
  taken?: readonly string[];
  onImported: (name: string) => void;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [archive, setArchive] = useState<ThemeArchive | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const problem = !trimmed
    ? null
    : !isThemeName(trimmed) || trimmed === KIT_FOLDER
      ? "invalid_name"
      : taken.includes(trimmed)
        ? "project_exists"
        : null;
  const shown = error ?? (archive ? problem : null);

  const reset = () => {
    setFile(null);
    setArchive(null);
    setName("");
    setError(null);
  };

  const pick = async (picked: File | null) => {
    reset();
    if (!picked) return;
    setFile(picked);
    const read = await readThemeZip(picked);
    if (!read.ok) return setError(read.error);
    setArchive(read.archive);
    setName(read.name ?? "");
  };

  const submit = async () => {
    if (busy || !archive || !trimmed || problem) return;
    setBusy(true);
    setError(null);
    try {
      await importTheme(serverKeyId, trimmed, archive);
      setOpen(false);
      reset();
      onImported(trimmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "import_failed");
    } finally {
      setBusy(false);
    }
  };

  const images = archive ? Object.keys(archive.binaries).length : 0;
  const colours = !!archive && THEME_COLORS_FILES.some((path) => path in archive.files);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("kit.importTheme.open")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("kit.importTheme.title")}</DialogTitle>
          <DialogDescription>{t("kit.importTheme.intro")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FileDropzone
            file={file}
            onFile={(picked) => void pick(picked)}
            accept=".zip"
            label={t("kit.importTheme.file")}
            prompt={t("kit.importTheme.drop")}
            hint={t("kit.importTheme.dropHint")}
            clearLabel={t("importProject.clear")}
          />
          {archive ? (
            <>
              <p className="text-[13px] text-[var(--text-mut)]" data-testid="import-theme-holds">
                {images === 0
                  ? t(colours ? "kit.importTheme.holdsColoursOnly" : "kit.importTheme.holdsNeither")
                  : t(colours ? "kit.importTheme.holdsColours" : "kit.importTheme.holds", {
                      count: images,
                    })}
              </p>
              <label htmlFor={fieldId} className="field-label flex flex-col gap-1.5">
                {t("kit.newTheme.name")}
                <Input
                  id={fieldId}
                  value={name}
                  placeholder={t("kit.newTheme.placeholder")}
                  disabled={busy}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(null);
                  }}
                />
              </label>
            </>
          ) : null}
          {shown ? (
            <div role="alert" className="text-xs text-[var(--danger)]">
              {t(`kit.importTheme.errors.${shown}`, {
                defaultValue: t("kit.importTheme.errors.import_failed"),
              })}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t("newProjectDialog.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !archive || !trimmed || !!problem}
            >
              {busy ? "…" : t("kit.importTheme.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
