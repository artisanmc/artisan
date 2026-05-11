import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AssetType } from "@/domain/asset";
import { uploadAsset } from "@/lib/packApi";
import { useSessionStore } from "@/state/sessionStore";
import { useState } from "react";
import { useAssetStore } from "./assetStore";

interface AssetUploadDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AssetUploadDialog({ open, onClose }: AssetUploadDialogProps) {
  const token = useSessionStore((s) => s.accessToken);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);

  const [type, setType] = useState<AssetType>("texture");
  const [name, setName] = useState("");
  const [ascent, setAscent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setType("texture"); setName(""); setAscent(""); setFile(null); setError(null);
  };

  const onSubmit = async () => {
    if (!token || !file || !name) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await uploadAsset(token, {
        file,
        type,
        name,
        ascent: type === "glyph" && ascent !== "" ? parseInt(ascent, 10) : undefined,
      });
      upsertAsset(asset);
      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Upload asset</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" name="type" checked={type === "texture"}
                     onChange={() => setType("texture")} /> Texture
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" name="type" checked={type === "glyph"}
                     onChange={() => setType("glyph")} /> Glyph
            </label>
          </div>
          <label className="text-xs">Name
            <Input value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="lowercase, digits, _ and - only" />
          </label>
          {type === "glyph" && (
            <label className="text-xs">Ascent
              <Input type="number" value={ascent} onChange={(e) => setAscent(e.target.value)}
                     placeholder="default: height-1" />
            </label>
          )}
          <label className="text-xs">File
            <input type="file" accept="image/png"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !name || !file} onClick={onSubmit}>Upload</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
