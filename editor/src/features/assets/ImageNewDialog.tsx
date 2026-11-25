import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { composeAsset, uploadAsset } from "@/lib/api/userAssets";
import { cx } from "@/lib/cx";
import type { ComposeRecipe } from "@/lib/pack/compose";
import { KIT_ASCENT, KIT_PREFIX, KIT_SLOTS, kitFootprint, kitSlot } from "@/lib/pack/kit";
import { createImage, encodePng } from "@/lib/pack/png";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { useAssetStore } from "./assetStore";
import { SLOT, WINDOW_WIDTH, windowHeight } from "./guideRules";
import { useKitAssets } from "./kitAssets";

/** What the image is for: its size follows from it. */
export type ImagePurpose = "menu" | "slots" | "icon" | "free";

const PURPOSES: readonly ImagePurpose[] = ["menu", "slots", "icon", "free"];
/** The slots a menu offers an image: a chest's, nine by six. */
const COLUMNS = 9;
const ROWS = 6;
const ICON = 16;
/** A side of an image of a free size: what the pixel editor stays comfortable with. */
const MAX_SIDE = 256;
const EMPTY = "";

const side = (text: string): number | null => {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= MAX_SIDE ? value : null;
};

/** The size an image of that purpose has, in pixels; `null` while a free size is not a size. */
export function sizeFor(
  purpose: ImagePurpose,
  choice: { rows: number; area: { columns: number; rows: number }; width: string; height: string },
): { width: number; height: number } | null {
  if (purpose === "menu") return { width: WINDOW_WIDTH, height: windowHeight(choice.rows) };
  if (purpose === "slots")
    return { width: choice.area.columns * SLOT, height: choice.area.rows * SLOT };
  if (purpose === "icon") return { width: ICON, height: ICON };
  const width = side(choice.width);
  const height = side(choice.height);
  return width !== null && height !== null ? { width, height } : null;
}

/**
 * The kit pieces an image of that purpose can start from: the window of that many rows, or
 * every piece of the base that covers those slots (`button.3x1` for 3 × 1).
 */
export function kitStarts(
  purpose: ImagePurpose,
  choice: { rows: number; area: { columns: number; rows: number } },
): string[] {
  if (purpose === "menu") return kitSlot(`window.${choice.rows}`) ? [`window.${choice.rows}`] : [];
  if (purpose !== "slots") return [];
  return KIT_SLOTS.filter((slot) => {
    const covers = kitFootprint(KIT_PREFIX + slot.id);
    return covers?.width === choice.area.columns && covers.height === choice.area.rows;
  }).map((slot) => slot.id);
}

/** The recipe of an image started from the kit piece `piece`: a window gets its slots too. */
export function startRecipe(
  purpose: ImagePurpose,
  piece: string,
  rows: number,
  size: { width: number; height: number },
): ComposeRecipe {
  const first = { image: KIT_PREFIX + piece, x: 0, y: 0, columns: 1, rows: 1 };
  if (purpose === "menu")
    return {
      layers: [first, { image: `${KIT_PREFIX}cell`, x: 7, y: 17, columns: COLUMNS, rows }],
      // As large as the kit's window, which is not always the game's height to the pixel.
      width: null,
      height: null,
    };
  return { layers: [first], width: size.width, height: size.height };
}

/** The slots an image covers, chosen on the menu's own grid: hover, then click the far corner. */
function SlotAreaPicker({
  value,
  onChange,
  label,
}: {
  value: { columns: number; rows: number };
  onChange: (value: { columns: number; rows: number }) => void;
  label: string;
}) {
  const [hover, setHover] = useState<{ columns: number; rows: number } | null>(null);
  const shown = hover ?? value;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a grid of toggle buttons, not a form fieldset
    <div
      role="group"
      aria-label={label}
      className="grid w-fit gap-0.5"
      style={{ gridTemplateColumns: `repeat(${COLUMNS}, 22px)` }}
      onPointerLeave={() => setHover(null)}
    >
      {Array.from({ length: ROWS * COLUMNS }, (_, index) => {
        const columns = (index % COLUMNS) + 1;
        const rows = Math.floor(index / COLUMNS) + 1;
        const on = columns <= shown.columns && rows <= shown.rows;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid
            key={index}
            type="button"
            aria-label={`${columns} × ${rows}`}
            aria-pressed={columns === value.columns && rows === value.rows}
            onPointerEnter={() => setHover({ columns, rows })}
            onFocus={() => setHover({ columns, rows })}
            onClick={() => onChange({ columns, rows })}
            className={cx(
              "size-[22px] cursor-pointer rounded-[4px] border p-0",
              on
                ? "border-[var(--brand)] bg-[var(--brand)]"
                : "border-[var(--border)] bg-[var(--surface-inset)]",
            )}
          />
        );
      })}
    </div>
  );
}

/**
 * Starts an image by what it is for, which gives its size: a menu's background (a chest's
 * rows), an image on slots (its width and height in slots), an icon, or a free size. It starts
 * empty, to be drawn, or from the kit piece of that size, which it then follows. Either way it
 * opens in the atelier (`ImageStudio`).
 */
export function ImageNewDialog({
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
  const kit = useKitAssets();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<ImagePurpose>("slots");
  const [rows, setRows] = useState(6);
  const [area, setArea] = useState({ columns: 3, rows: 1 });
  const [width, setWidth] = useState("32");
  const [height, setHeight] = useState("32");
  /** The kit piece to start from; empty: an empty image. */
  const [start, setStart] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choice = { rows, area, width, height };
  const size = sizeFor(purpose, choice);
  const starts = kitStarts(purpose, choice);
  // The kit piece of that size by default: an image that follows the kit is the better start.
  const from =
    start !== null && (start === EMPTY || starts.includes(start)) ? start : (starts[0] ?? EMPTY);
  const valid = /^[a-z0-9_-]+$/.test(name) && size !== null;

  const create = async () => {
    if (!user || !valid || busy || !size) return;
    setBusy(true);
    setError(null);
    try {
      const usages = purpose === "menu" ? (["menu"] as const) : (["button"] as const);
      // A window is drawn from the top edge of the title, as the kit's are.
      const ascent = purpose === "menu" ? { ascent: KIT_ASCENT } : {};
      const asset =
        from === EMPTY
          ? await uploadAsset(projectId, {
              file: new File(
                [encodePng(createImage(size.width, size.height)) as Uint8Array<ArrayBuffer>],
                `${name}.png`,
                { type: "image/png" },
              ),
              type: "glyph",
              name,
              usages: [...usages],
              ...ascent,
            })
          : await composeAsset(projectId, {
              name,
              usages: [...usages],
              ...ascent,
              recipe: startRecipe(purpose, from, rows, size),
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("imageNew.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-[var(--text-mut)]">{t("imageNew.hint")}</p>
          <Segmented
            label={t("imageNew.purpose")}
            value={purpose}
            onChange={setPurpose}
            options={PURPOSES.map((value) => ({ value, label: t(`imageNew.for.${value}`) }))}
          />

          {purpose === "menu" && (
            <div className="flex flex-col gap-1">
              <span className="field-label">{t("imageNew.rows")}</span>
              <Segmented
                label={t("imageNew.rows")}
                value={rows}
                onChange={setRows}
                options={[1, 2, 3, 4, 5, 6].map((value) => ({ value, label: String(value) }))}
              />
            </div>
          )}
          {purpose === "slots" && (
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex flex-col gap-1">
                <span className="field-label">{t("imageNew.area")}</span>
                <SlotAreaPicker value={area} onChange={setArea} label={t("imageNew.area")} />
              </div>
              <p className="max-w-52 pt-5 text-xs text-[var(--text-mut)]">
                {t("imageNew.areaHint")}
              </p>
            </div>
          )}
          {purpose === "free" && (
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
          <p className="font-mono text-xs text-[var(--text-mut)]" data-testid="image-new-size">
            {purpose === "slots" ? `${area.columns} × ${area.rows} slots · ` : ""}
            {size ? `${size.width} × ${size.height} px` : t("imageNew.badSize", { max: MAX_SIDE })}
          </p>

          <div className="flex flex-col gap-1">
            <span className="field-label">{t("imageNew.start")}</span>
            {/* biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form fieldset */}
            <div role="group" aria-label={t("imageNew.start")} className="flex flex-wrap gap-1.5">
              {[...starts, EMPTY].map((piece) => {
                const asset = kit.find((a) => a.id === KIT_PREFIX + piece);
                return (
                  <button
                    key={piece}
                    type="button"
                    aria-pressed={from === piece}
                    onClick={() => setStart(piece)}
                    className={cx(
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded-[8px] border px-2.5 py-1.5 text-xs",
                      from === piece
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--text)]"
                        : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-mut)]",
                    )}
                  >
                    {asset && (
                      <AssetPreview asset={asset} className="h-6 max-w-16 object-contain" />
                    )}
                    {piece === EMPTY ? t("imageNew.empty") : KIT_PREFIX + piece}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--text-faint)]">
              {t(
                from === EMPTY
                  ? starts.length > 0
                    ? "imageNew.emptyHint"
                    : "imageNew.noPiece"
                  : "imageNew.kitHint",
              )}
            </p>
          </div>

          <label className="text-xs" htmlFor={nameId}>
            {t("assetUpload.name")}
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("assetUpload.namePlaceholder")}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("assetUpload.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={busy || !valid || !user}
              onClick={() => void create()}
            >
              {t("imageNew.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
