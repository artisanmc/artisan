import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { uploadAsset } from "@/lib/api/userAssets";
import { createImage, encodePng } from "@/lib/pack/png";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssetStore } from "./assetStore";

/** The sizes offered: an item-sized icon, one slot, a button of three slots. */
const SIZES = {
  icon: [16, 16],
  slot: [18, 18],
  button: [54, 18],
} as const;
type Preset = keyof typeof SIZES | "custom";

/** A side of a drawn image: what the pixel editor stays comfortable with. */
const MAX_SIDE = 256;

const side = (text: string): number | null => {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= MAX_SIDE ? value : null;
};

/**
 * Starts an image drawn by hand: a name and a size, then an empty (transparent) PNG of that
 * size, which the pixel editor (`PixelEditor`) opens on.
 */
export function PixelNewDialog({
  projectId,
  open,
  onClose,
  onCreated,
}: {
  projectId: ProjectId;
  open: boolean;
  onClose: () => void;
  onCreated: (asset: Asset) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const user = useProjectPrincipalId(projectId);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<Preset>("icon");
  const [width, setWidth] = useState("16");
  const [height, setHeight] = useState("16");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = preset === "custom" ? [side(width), side(height)] : SIZES[preset];
  const valid = /^[a-z0-9_-]+$/.test(name) && size[0] !== null && size[1] !== null;

  const create = async () => {
    if (!user || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const png = encodePng(createImage(size[0] as number, size[1] as number));
      const asset = await uploadAsset(projectId, {
        file: new File([png as Uint8Array<ArrayBuffer>], `${name}.png`, { type: "image/png" }),
        type: "glyph",
        name,
        usages: ["button"],
      });
      upsertAsset(asset);
      setName("");
      onCreated(asset);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
          <DialogTitle>{t("pixel.newTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--text-mut)]">{t("pixel.newHint")}</p>
          <label className="text-xs" htmlFor={nameId}>
            {t("assetUpload.name")}
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("assetUpload.namePlaceholder")}
            />
          </label>
          <Segmented
            label={t("pixel.newSize")}
            value={preset}
            onChange={setPreset}
            options={[
              { value: "icon", label: t("pixel.newIcon") },
              { value: "slot", label: t("pixel.newSlot") },
              { value: "button", label: t("pixel.newButton") },
              { value: "custom", label: t("pixel.newCustom") },
            ]}
          />
          {preset === "custom" && (
            <div className="flex gap-2">
              <Input
                type="number"
                aria-label={t("compose.width")}
                min={1}
                max={MAX_SIDE}
                value={width}
                onChange={(event) => setWidth(event.target.value)}
                className="w-20 font-mono text-xs"
              />
              <Input
                type="number"
                aria-label={t("compose.height")}
                min={1}
                max={MAX_SIDE}
                value={height}
                onChange={(event) => setHeight(event.target.value)}
                className="w-20 font-mono text-xs"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("assetUpload.cancel")}
            </Button>
            <Button disabled={busy || !valid || !user} onClick={() => void create()}>
              {t("pixel.newCreate")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
