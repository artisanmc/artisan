import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { imageButtonRect, imageButtonSize, rectanglePositions } from "@/domain/imageButton";
import type { Appearance, Element, LText, Menu, ProjectId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { AssetPreview } from "@/features/assets/AssetPreview";
import { useImageAsset } from "@/features/assets/kitAssets";
import { colsFor, rowsFor } from "@/features/canvas/inventoryTypes";
import { TextSizeSelector } from "@/features/canvas/title/composer/TextSizeSelector";
import { cx } from "@/lib/cx";
import { kitFootprint } from "@/lib/pack/kit";
import type { PartsEdit } from "@/state/projects/elementsSlice";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PART_ANCHORS,
  type PartAnchor,
} from "../../../../../docs/schema/menu/v1/imageButtonGeometry";

type Part = NonNullable<Appearance["parts"]>[number];

/**
 * The pieces of a look: images and texts drawn bottom to top over the element's slots,
 * each placed by an anchor and offsets (ADR `element-parts-and-sliced-images`). Adding a
 * piece to a look that has an image or a label turns those two into pieces first.
 */
export function PartsEditor({
  projectId,
  menu,
  element,
  appearance,
  lang,
  textOf,
  onEdit,
  onPositions,
  selected,
  onSelect,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
  appearance: Appearance;
  /** The language the texts are edited in. */
  lang: string;
  textOf: (text: LText) => string;
  onEdit: (op: PartsEdit) => void;
  onPositions: (positions: string) => void;
  /** The piece in hand where pieces are moved on a scene (a component's page). */
  selected?: number | null;
  onSelect?: (index: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  // `add`: a new image piece; a number: the piece whose image is replaced.
  const [picking, setPicking] = useState<"add" | number | null>(null);
  const [error, setError] = useState("");
  const parts = appearance.parts ?? [];
  const type = menu.inventoryType ?? "chest";
  const rect = imageButtonRect(element.positions, type, menu.rows, menu.playerInventory);
  const drawsImage = parts.some((part) => "image" in part) || !!appearance.image;
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
  const pick = (picked: Asset) => {
    if (typeof picking === "number") {
      onEdit({ type: "patch", index: picking, patch: { image: picked.id } });
      return;
    }
    // A first image gives the element the slots it covers at its own size.
    let positions: string | undefined;
    if (!drawsImage) {
      if (!rect) throw new Error(t("imageButton.rectangleRequired"));
      const size = kitFootprint(picked.id) ?? imageButtonSize(picked.width, picked.height);
      positions = rectanglePositions(
        rect.slot,
        size.width,
        size.height,
        type,
        menu.rows,
        menu.playerInventory,
      );
    }
    onEdit({ type: "addImage", asset: picked.id, positions });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="field-label !mb-0">{t("parts.title")}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setPicking("add")}>
            {t("parts.addImage")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => perform(() => onEdit({ type: "addLabel", lang }))}
          >
            {t("parts.addText")}
          </Button>
        </div>
      </div>
      {!appearance.parts && <p className="text-xs text-[var(--text-mut)]">{t("parts.hint")}</p>}
      {drawsImage && appearance.parts && (
        <div className="grid grid-cols-2 gap-2">
          <label className="field-label" htmlFor={`${id}-width`}>
            {t("imageButton.width")}
            <Input
              id={`${id}-width`}
              type="number"
              min={1}
              max={colsFor(type)}
              value={rect?.width ?? 1}
              onChange={(event) => resize(Number(event.target.value), rect?.height ?? 1)}
            />
          </label>
          <label className="field-label" htmlFor={`${id}-height`}>
            {t("imageButton.height")}
            <Input
              id={`${id}-height`}
              type="number"
              min={1}
              max={rowsFor(type, menu.rows)}
              value={rect?.height ?? 1}
              onChange={(event) => resize(rect?.width ?? 1, Number(event.target.value))}
            />
          </label>
        </div>
      )}
      <ol className="flex flex-col gap-2" aria-label={t("parts.title")}>
        {/* As a drawing program lists layers: the piece in front first. */}
        {parts
          .map((part, index) => ({ part, index }))
          .reverse()
          .map(({ part, index }) => (
            <PartRow
              // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a look have no id, their order is their identity
              key={index}
              projectId={projectId}
              part={part}
              index={index}
              count={parts.length}
              text={"image" in part ? "" : textOf(part.label)}
              onEdit={(op) => perform(() => onEdit(op))}
              onText={(value) => onEdit({ type: "text", index, lang, value })}
              onChoose={() => setPicking(index)}
              selected={selected === index}
              onSelect={onSelect ? () => onSelect(index) : undefined}
            />
          ))}
      </ol>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      <AssetPicker
        usage="button"
        named
        open={picking !== null}
        projectId={projectId}
        onClose={() => setPicking(null)}
        title={t("imageButton.choose")}
        onPick={(picked) =>
          perform(() => {
            pick(picked);
            setPicking(null);
          })
        }
      />
    </div>
  );
}

function PartRow({
  projectId,
  part,
  index,
  count,
  text,
  onEdit,
  onText,
  onChoose,
  selected,
  onSelect,
}: {
  projectId: ProjectId;
  part: Part;
  selected?: boolean;
  onSelect?: () => void;
  index: number;
  count: number;
  text: string;
  onEdit: (op: PartsEdit) => void;
  onText: (value: string) => void;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const isImage = "image" in part;
  const asset = useImageAsset(projectId, isImage ? part.image : undefined);
  const patch = (value: Extract<PartsEdit, { type: "patch" }>["patch"]) =>
    onEdit({ type: "patch", index, patch: value });
  const limit = isImage ? 4096 : 256;
  const title = isImage ? `${t("parts.image")} · ${asset?.name ?? part.image}` : t("parts.text");
  return (
    <li
      className={cx("card flex flex-col gap-2 p-2", selected && "!border-[var(--brand)]")}
      data-testid="part-row"
    >
      <div className="flex items-center gap-1">
        {onSelect ? (
          <button
            type="button"
            aria-pressed={!!selected}
            className="eyebrow min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left"
            onClick={onSelect}
          >
            {title}
          </button>
        ) : (
          <span className="eyebrow flex-1 truncate">{title}</span>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("parts.up")}
          title={t("parts.up")}
          disabled={index === count - 1}
          onClick={() => onEdit({ type: "move", index, to: index + 1 })}
        >
          <ArrowUp size={14} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("parts.down")}
          title={t("parts.down")}
          disabled={index === 0}
          onClick={() => onEdit({ type: "move", index, to: index - 1 })}
        >
          <ArrowDown size={14} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("parts.remove")}
          title={t("parts.remove")}
          onClick={() => onEdit({ type: "remove", index })}
        >
          <X size={14} />
        </Button>
      </div>
      {isImage ? (
        <div className="flex items-center gap-2">
          {asset && <AssetPreview asset={asset} className="h-10 w-16 object-contain" />}
          <Button size="sm" variant="outline" onClick={onChoose}>
            {t("imageButton.choose")}
          </Button>
        </div>
      ) : (
        <Input
          aria-label={t("parts.text")}
          value={text}
          placeholder={t("elementLabel.placeholder")}
          onChange={(event) => onText(event.target.value)}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="field-label" htmlFor={`${id}-anchor`}>
          {t("parts.anchor")}
          <select
            id={`${id}-anchor`}
            className="input w-full"
            value={part.anchor ?? "center"}
            onChange={(event) => {
              const anchor = event.target.value as PartAnchor;
              patch({ anchor: anchor === "center" ? undefined : anchor });
            }}
          >
            {PART_ANCHORS.map((anchor) => (
              <option key={anchor} value={anchor}>
                {t(`parts.anchors.${anchor}`)}
              </option>
            ))}
          </select>
        </label>
        {isImage ? (
          <label className="field-label" htmlFor={`${id}-fit`}>
            {t("imageButton.fit")}
            <select
              id={`${id}-fit`}
              className="input w-full"
              value={part.fit ?? "native"}
              onChange={(event) => {
                const fit = event.target.value as "native" | "contain" | "stretch";
                patch({ fit: fit === "native" ? undefined : fit });
              }}
            >
              <option value="native">{t("imageButton.native")}</option>
              <option value="contain">{t("imageButton.contain")}</option>
              <option value="stretch">{t("imageButton.stretch")}</option>
            </select>
          </label>
        ) : (
          <TextSizeSelector
            id={`${id}-size`}
            value={part.size}
            onChange={(size) => patch({ size })}
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["offset_x", "offset_y"] as const).map((axis) => (
          <label key={axis} className="field-label" htmlFor={`${id}-${axis}`}>
            {t(axis === "offset_x" ? "imageButton.offsetX" : "imageButton.offsetY")}
            <Input
              id={`${id}-${axis}`}
              type="number"
              step={1}
              min={-limit}
              max={limit}
              value={part[axis] ?? 0}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && Math.abs(value) <= limit)
                  patch({ [axis]: value === 0 ? undefined : value });
              }}
            />
          </label>
        ))}
      </div>
    </li>
  );
}
