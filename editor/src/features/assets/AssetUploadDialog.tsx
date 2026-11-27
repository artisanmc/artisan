import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Input } from "@/components/ui/input";
import type { Asset, AssetUsage } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { uploadAsset } from "@/lib/api/userAssets";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssetStore } from "./assetStore";
import { addToLibrary, libraryImage, useLibraryFor } from "./libraryDraft";

interface AssetUploadDialogProps {
  projectId: ProjectId;
  open: boolean;
  onClose: () => void;
  onUploaded?: (asset: Asset) => void;
  usage?: AssetUsage;
  /**
   * The image is for a menu to name: it goes to the server's library, not to the menu's module
   * (ADR `themes-reach-modules`, decision 1), where the server has one a module may write in
   * (`libraryFor`). `onUploaded` then gets it as a common image (`kit:<name>`).
   */
  toLibrary?: boolean;
}

/** An asset name (lowercase, digits, `_`, `-`) derived from a file name. */
export function assetNameFromFile(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "image"
  );
}

/**
 * Image upload dialog. The internal `asset.type` distinction
 * (texture / glyph) is intentionally hidden from the user — they think in
 * terms of "an image". We always upload as `glyph` because it has the
 * broadest capability (allocates a font codepoint so the asset can be
 * used in titles AND as a slot icon), and existing texture-typed assets
 * keep working unchanged. Font uploads have their own dedicated dialog
 * (`AssetImportFontDialog`) — that concept stays distinct in the UI.
 */
export function AssetUploadDialog({
  projectId,
  open,
  onClose,
  onUploaded,
  usage,
  toLibrary,
}: AssetUploadDialogProps) {
  const nameId = useId();
  const { t } = useTranslation();
  const user = useProjectPrincipalId(projectId);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const found = useLibraryFor(projectId);
  const library = toLibrary ? found : null;

  const [name, setName] = useState("");
  const [nameTyped, setNameTyped] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Filed under the use it is imported for; from the Resources, under none: every list offers it.
  const usages: AssetUsage[] = usage ? [usage] : [];

  const reset = () => {
    setName("");
    setNameTyped(false);
    setFile(null);
    setError(null);
  };

  const onFile = (picked: File | null) => {
    setFile(picked);
    if (picked && !nameTyped) setName(assetNameFromFile(picked.name));
  };

  const onSubmit = async () => {
    if (!user || !file || !name) return;
    setBusy(true);
    setError(null);
    try {
      if (library) {
        // The module's image of a name is shown before the library's: the new one would not be.
        const own = useAssetStore.getState().assets;
        if (own.some((a) => a.projectId === projectId && !a.under && a.name === name))
          throw new Error(t("assetUpload.nameInModule"));
        const added = await addToLibrary(library, { file, name, usages }).catch((cause) => {
          if ((cause as { status?: number } | null)?.status === 409)
            throw new Error(t("assetUpload.nameInLibrary"));
          throw cause;
        });
        reset();
        onUploaded?.(libraryImage(added));
        onClose();
        return;
      }
      // Always `glyph` — see the component docblock for the rationale.
      // Glyph uploads get a font codepoint, which makes the asset usable
      // everywhere (titles + slot icons).
      const asset = await uploadAsset(projectId, { file, type: "glyph", name, usages });
      upsertAsset(asset);
      reset();
      onUploaded?.(asset);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("assetUpload.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <FileDropzone
            file={file}
            onFile={onFile}
            accept="image/png"
            label={t("assetUpload.file")}
            prompt={t("assetUpload.dropPrompt")}
            hint={t("assetUpload.dropHint")}
            clearLabel={t("assetUpload.clear")}
          />
          <label className="text-xs" htmlFor={nameId}>
            {t("assetUpload.name")}
            <Input
              id={nameId}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTyped(e.target.value !== "");
              }}
              placeholder={t("assetUpload.namePlaceholder")}
            />
          </label>
          {library && (
            <p className="text-xs text-[var(--text-mut)]">{t("assetUpload.toLibrary")}</p>
          )}
          {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("assetUpload.cancel")}
            </Button>
            <Button disabled={busy || !name || !file} onClick={onSubmit}>
              {t("assetUpload.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
