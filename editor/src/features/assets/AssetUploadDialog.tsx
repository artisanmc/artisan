import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Input } from "@/components/ui/input";
import type { Asset, AssetUsage } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { uploadAsset } from "@/lib/api/userAssets";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetUsageFields } from "./AssetUsageFields";
import { useAssetStore } from "./assetStore";

interface AssetUploadDialogProps {
  projectId: ProjectId;
  open: boolean;
  onClose: () => void;
  onUploaded?: (asset: Asset) => void;
  usage?: AssetUsage;
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
}: AssetUploadDialogProps) {
  const nameId = useId();
  const { t } = useTranslation();
  const user = useProjectPrincipalId(projectId);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);

  const [name, setName] = useState("");
  const [nameTyped, setNameTyped] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usages, setUsages] = useState<AssetUsage[]>(usage ? [usage] : []);
  useEffect(() => {
    if (open) setUsages(usage ? [usage] : []);
  }, [open, usage]);

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
      // Always `glyph` — see the component docblock for the rationale.
      // The backend allocates a font codepoint for glyph uploads, which
      // makes the asset usable everywhere (titles + slot icons).
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
          <AssetUsageFields value={usages} onChange={setUsages} requiredUsage={usage} />
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
