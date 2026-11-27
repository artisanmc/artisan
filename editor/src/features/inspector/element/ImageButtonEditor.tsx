import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { imageButtonRect, imageButtonSize, rectanglePositions } from "@/domain/imageButton";
import type { Appearance, Element, Menu, ProjectId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { AssetPreview } from "@/features/assets/AssetPreview";
import { ImageReachNote } from "@/features/assets/ImageReachNote";
import { imageSlots, useImageAsset } from "@/features/assets/kitAssets";
import { colsFor, rowsFor } from "@/features/canvas/inventoryTypes";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";

/** The slots an image covers: a kit image's name says them, another's size gives them. */
const footprint = (asset: Asset) => imageSlots(asset) ?? imageButtonSize(asset.width, asset.height);

export function ImageButtonEditor({
  projectId,
  menu,
  element,
  image,
  onImage,
  onPositions,
  onItem,
  children,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
  image?: Appearance["image"];
  onImage: (image: Appearance["image"], positions?: string) => void;
  onPositions: (positions: string) => void;
  onItem: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const controlId = useId();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const asset = useImageAsset(projectId, image?.asset);
  const type = menu.inventoryType ?? "chest";
  const rect = imageButtonRect(element.positions, type, menu.rows, menu.playerInventory);
  const perform = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const resize = (width: number, height: number) =>
    perform(() => {
      if (!rect) throw new Error(t("imageButton.rectangleRequired"));
      onPositions(
        rectanglePositions(rect.slot, width, height, type, menu.rows, menu.playerInventory),
      );
    });
  /** The image chosen: kept at the button's fit, or a first image at its natural size. */
  const pick = (picked: Asset, done: () => void) => {
    const ref = picked.id;
    if (image) onImage({ ...image, asset: ref });
    else {
      if (!rect) throw new Error(t("imageButton.rectangleRequired"));
      const size = footprint(picked);
      onImage(
        { asset: ref, fit: "native" },
        rectanglePositions(
          rect.slot,
          size.width,
          size.height,
          type,
          menu.rows,
          menu.playerInventory,
        ),
      );
    }
    done();
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1" aria-label={t("imageButton.appearance")}>
        <Button
          size="sm"
          variant={!image ? "secondary" : "ghost"}
          aria-pressed={!image}
          onClick={() => perform(onItem)}
        >
          {t("imageButton.item")}
        </Button>
        <Button
          size="sm"
          variant={image ? "secondary" : "ghost"}
          aria-pressed={!!image}
          disabled={!!element.iterates || !!element.places}
          onClick={() => setPicking(true)}
        >
          {t("imageButton.image")}
        </Button>
      </div>
      {image && (
        <>
          {asset && <AssetPreview asset={asset} className="h-20 w-full object-contain" />}
          <ImageReachNote
            projectId={projectId}
            name={image.asset}
            onRename={(ref) => onImage({ ...image, asset: ref })}
          />
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
            {t("imageButton.choose")}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <label className="field-label" htmlFor={`${controlId}-width`}>
              {t("imageButton.width")}
              <Input
                id={`${controlId}-width`}
                type="number"
                min={1}
                max={colsFor(type)}
                value={rect?.width ?? 1}
                onChange={(event) => resize(Number(event.target.value), rect?.height ?? 1)}
              />
            </label>
            <label className="field-label" htmlFor={`${controlId}-height`}>
              {t("imageButton.height")}
              <Input
                id={`${controlId}-height`}
                type="number"
                min={1}
                max={rowsFor(type, menu.rows)}
                value={rect?.height ?? 1}
                onChange={(event) => resize(rect?.width ?? 1, Number(event.target.value))}
              />
            </label>
          </div>
          <label className="field-label">
            {t("imageButton.fit")}
            <select
              className="input w-full"
              value={image.fit ?? "contain"}
              onChange={(event) =>
                perform(() =>
                  onImage({
                    ...image,
                    fit: event.target.value as NonNullable<Appearance["image"]>["fit"],
                  }),
                )
              }
            >
              <option value="native">{t("imageButton.native")}</option>
              <option value="contain">{t("imageButton.contain")}</option>
              <option value="stretch">{t("imageButton.stretch")}</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["offset_x", "offset_y"] as const).map((axis) => (
              <label key={axis} className="field-label" htmlFor={`${controlId}-${axis}`}>
                {t(axis === "offset_x" ? "imageButton.offsetX" : "imageButton.offsetY")}
                <Input
                  id={`${controlId}-${axis}`}
                  type="number"
                  step={1}
                  min={-4096}
                  max={4096}
                  value={image[axis] ?? 0}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value) && Math.abs(value) <= 4096)
                      perform(() => onImage({ ...image, [axis]: value }));
                  }}
                />
              </label>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => perform(() => onImage({ ...image, offset_x: 0, offset_y: 0 }))}
          >
            {t("imageButton.recenter")}
          </Button>
          {asset && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const size = footprint(asset);
                resize(size.width, size.height);
              }}
            >
              {t("imageButton.autoSize")}
            </Button>
          )}
          <p className="text-xs text-[var(--text-mut)]">{t("imageButton.sharedArea")}</p>
          {children}
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      <AssetPicker
        usage="button"
        named
        open={picking}
        projectId={projectId}
        onClose={() => setPicking(false)}
        title={t("imageButton.choose")}
        onPick={(picked) => perform(() => pick(picked, () => setPicking(false)))}
      />
    </div>
  );
}
