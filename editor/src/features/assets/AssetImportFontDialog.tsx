import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectId } from "@/domain/types";
import { uploadFontAsset } from "@/lib/api/userAssets";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useId, useState } from "react";
import { useAssetStore } from "./assetStore";

interface AssetImportFontDialogProps {
  projectId: ProjectId;
  open: boolean;
  onClose: () => void;
}

/** Normalize a filename stem to the `[a-z0-9_-]+` charset used for asset names. */
export function normalizeFontName(stem: string): string {
  const lower = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  // Collapse runs of underscores and trim leading/trailing underscores.
  return lower.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function stripZipExtension(filename: string): string {
  return filename.replace(/\.zip$/i, "");
}

export function AssetImportFontDialog({ projectId, open, onClose }: AssetImportFontDialogProps) {
  const user = useProjectPrincipalId(projectId);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const nameInputId = useId();
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setName("");
    setError(null);
    setWarnings([]);
  };

  const onFileChange = (f: File | null) => {
    setFile(f);
    setError(null);
    if (f) {
      const stem = stripZipExtension(f.name);
      setName(normalizeFontName(stem));
    }
  };

  const onSubmit = async () => {
    if (!user || !file || !name) return;
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const result = await uploadFontAsset(projectId, { name, file });
      upsertAsset(result.asset);
      if (result.warnings && result.warnings.length > 0) {
        // Surface warnings to the user, but still close the dialog after a short delay.
        setWarnings(result.warnings);
        setTimeout(() => {
          reset();
          onClose();
        }, 1500);
      } else {
        reset();
        onClose();
      }
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
          <DialogTitle>Import MCFonts zip</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="text-xs">
            Zip file
            <input
              type="file"
              accept=".zip"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && (
            <div className="text-xs text-muted-foreground">Ready to import — {file.size} bytes</div>
          )}
          <label htmlFor={nameInputId} className="text-xs">
            Name
            <Input
              id={nameInputId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="lowercase, digits, _ and - only"
            />
          </label>
          {warnings.length > 0 && (
            <output className="text-xs text-yellow-400 flex flex-col gap-1">
              {warnings.map((w, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: server warnings may repeat verbatim and the list is only ever replaced wholesale, never reordered
                <div key={i}>{w}</div>
              ))}
            </output>
          )}
          {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !name || !file} onClick={onSubmit}>
              Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
