import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { imageButtonRect, imageButtonSize, rectanglePositions } from "@/domain/imageButton";
import type { Appearance, Element, Menu, ProjectId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { AssetPreview } from "@/features/assets/AssetPreview";
import { useAssetStore } from "@/features/assets/assetStore";
import { colsFor, rowsFor } from "@/features/canvas/inventoryTypes";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const assets = useAssetStore((state) => state.assets);
  const asset = assets.find((entry) => entry.id === image?.asset && entry.projectId === projectId);
  const type = menu.inventoryType ?? "chest";
  const rect = imageButtonRect(element.positions, type, menu.rows);
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
      onPositions(rectanglePositions(rect.slot, width, height, type, menu.rows));
    });
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
                const size = imageButtonSize(asset.width, asset.height);
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
        open={picking}
        projectId={projectId}
        onClose={() => setPicking(false)}
        title={t("imageButton.choose")}
        onPick={(picked) =>
          perform(() => {
            if (image) onImage({ ...image, asset: picked.id });
            else {
              if (!rect) throw new Error(t("imageButton.rectangleRequired"));
              const size = imageButtonSize(picked.width, picked.height);
              onImage(
                { asset: picked.id, fit: "native" },
                rectanglePositions(rect.slot, size.width, size.height, type, menu.rows),
              );
            }
            setPicking(false);
          })
        }
      />
    </div>
  );
}
