/** Where a piece sits in its element's rectangle: one of nine places, the centre by default. */
export type PartAnchor =
  | "center"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right";

export const PART_ANCHORS: readonly PartAnchor[] = [
  "center",
  "left",
  "right",
  "top",
  "bottom",
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
];

/** The two axes of an anchor; a name that is not one of the nine is the centre. */
export function anchorAxes(anchor: unknown): {
  h: "left" | "center" | "right";
  v: "top" | "center" | "bottom";
} {
  const a = typeof anchor === "string" ? anchor : "";
  return {
    h:
      a === "left" || a.endsWith("_left")
        ? "left"
        : a === "right" || a.endsWith("_right")
          ? "right"
          : "center",
    v:
      a === "top" || a.startsWith("top_")
        ? "top"
        : a === "bottom" || a.startsWith("bottom_")
          ? "bottom"
          : "center",
  };
}

export interface ImageButtonImage {
  asset: string;
  fit?: "contain" | "stretch" | "native";
  offset_x?: number;
  offset_y?: number;
  anchor?: PartAnchor;
}

/** One piece of a look (`parts`): an image by its name, or a text. */
export type LookPart<Text = string | Record<string, string>> =
  | {
      image: string;
      fit?: ImageButtonImage["fit"];
      anchor?: PartAnchor;
      offset_x?: number;
      offset_y?: number;
    }
  | {
      label: Text;
      anchor?: PartAnchor;
      size?: ElementLabel["size"];
      offset_x?: number;
      offset_y?: number;
    };

type RawLook = Record<string, unknown> | null | undefined;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const defined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * The images a look draws, bottom to top, each in the shape of `image` (unchecked: the reader
 * checks what it uses). A look with `parts` draws its image pieces, at their own size unless
 * `fit` says otherwise; else its `image`, if any.
 */
export function lookImages(look: unknown): unknown[] {
  const app = look as RawLook;
  if (!isRecord(app)) return [];
  if (!Array.isArray(app.parts)) return app.image ? [app.image] : [];
  return app.parts
    .filter(isRecord)
    .filter((part) => typeof part.image === "string")
    .map((part) =>
      defined({
        asset: part.image,
        fit: part.fit ?? "native",
        offset_x: part.offset_x,
        offset_y: part.offset_y,
        anchor: part.anchor,
      }),
    );
}

/**
 * The texts a look draws, each in the shape of `label` plus `valign` (unchecked). A text piece
 * is aligned by its anchor: `left` and `right` as `align`, `top` and `bottom` as `valign`.
 */
export function lookLabels(look: unknown): unknown[] {
  const app = look as RawLook;
  if (!isRecord(app)) return [];
  if (!Array.isArray(app.parts)) return app.label ? [app.label] : [];
  return app.parts
    .filter(isRecord)
    .filter(
      (part) => typeof part.image !== "string" && part.label !== undefined && part.label !== null,
    )
    .map((part) => {
      const { h, v } = anchorAxes(part.anchor);
      return defined({
        text: part.label,
        align: h,
        valign: v,
        size: part.size,
        offset_x: part.offset_x,
        offset_y: part.offset_y,
      });
    });
}

/** A slot's stride in a menu, in Minecraft pixels: N slots side by side span N times this. */
const SLOT_STRIDE = 18;

/**
 * The slots an image of that size covers: as many as it needs to fit, N slots spanning N × 18
 * pixels. A 54 × 18 button takes 3 × 1, a 16 × 16 icon one slot, a 48 × 16 strip of icons 3 × 1.
 */
export function imageButtonSize(width: number, height: number) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0))
    throw new Error("Invalid image dimensions.");
  return { width: Math.ceil(width / SLOT_STRIDE), height: Math.ceil(height / SLOT_STRIDE) };
}

/** Coordinates in Minecraft pixels, shared by the canvas and resource pack. */
export function imageButtonGeometry(
  image: ImageButtonImage,
  sourceWidth: number,
  sourceHeight: number,
  areaWidth: number,
  areaHeight: number,
) {
  const ratio =
    image.fit === "native" ? 1 : Math.min(areaWidth / sourceWidth, areaHeight / sourceHeight);
  const width = image.fit === "stretch" ? areaWidth : Math.max(1, Math.round(sourceWidth * ratio));
  const height =
    image.fit === "stretch" ? areaHeight : Math.max(1, Math.round(sourceHeight * ratio));
  const { h, v } = anchorAxes(image.anchor);
  return {
    width,
    height,
    x:
      (h === "left" ? 0 : h === "right" ? areaWidth - width : Math.floor((areaWidth - width) / 2)) +
      (image.offset_x ?? 0),
    y:
      (v === "top"
        ? 0
        : v === "bottom"
          ? areaHeight - height
          : Math.floor((areaHeight - height) / 2)) + (image.offset_y ?? 0),
  };
}

export type ImageButtonContainer = "chest" | "hopper" | "dropper";

/** Slot grid of each container, in Minecraft pixels (outer cell of slot 0). */
const MENU_GRID: Record<ImageButtonContainer, { cols: number; x: number; y: number }> = {
  chest: { cols: 9, x: 7, y: 17 },
  hopper: { cols: 5, x: 43, y: 19 },
  dropper: { cols: 3, x: 61, y: 16 },
};

/** Top of the player inventory's first row, by container (chest: after its rows). */
function playerInventoryY(type: ImageButtonContainer, size: number): number {
  if (type === "hopper") return 50;
  if (type === "dropper") return 83;
  return 30 + (size / 9) * 18;
}

/**
 * Rectangle of slots an image button covers, and where its image is drawn.
 *
 * Slots are protocol raw slots: `0..size-1` the menu, then (only when the
 * bottom is hidden, `player_inventory: hidden`) 27 inventory slots and 9
 * hotbar slots. A button stays inside one section — menu grid, inventory
 * rows or hotbar — since the gaps between them break the slot grid.
 * `null` when the slots are not a full rectangle of one section.
 */
export function imageButtonArea(
  slots: readonly number[],
  type: ImageButtonContainer,
  size: number,
  playerInventoryHidden: boolean,
): { slot: number; width: number; height: number; x: number; y: number } | null {
  if (!slots.length) return null;
  const limit = size + (playerInventoryHidden ? 36 : 0);
  const cell = (slot: number) => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= limit) return null;
    if (slot < size) {
      const g = MENU_GRID[type];
      return { section: 0, col: slot % g.cols, row: Math.floor(slot / g.cols), x: g.x, y: g.y };
    }
    const j = slot - size;
    const top = playerInventoryY(type, size);
    return j < 27
      ? { section: 1, col: j % 9, row: Math.floor(j / 9), x: 7, y: top }
      : { section: 2, col: j - 27, row: 0, x: 7, y: top + 58 };
  };
  const cells = slots.map(cell);
  if (cells.some((c) => c === null)) return null;
  const all = cells as NonNullable<ReturnType<typeof cell>>[];
  if (all.some((c) => c.section !== all[0]!.section)) return null;
  const left = Math.min(...all.map((c) => c.col));
  const right = Math.max(...all.map((c) => c.col));
  const topRow = Math.min(...all.map((c) => c.row));
  const bottomRow = Math.max(...all.map((c) => c.row));
  const width = right - left + 1;
  const height = bottomRow - topRow + 1;
  if (new Set(slots).size !== width * height) return null;
  const first = all[0]!;
  const slot = Math.min(...slots);
  return { slot, width, height, x: first.x + left * 18, y: first.y + topRow * 18 };
}

export type LabelAlign = "left" | "center" | "right";

/** Text drawn in the title over an element's slot rectangle (fixed elements only). */
export interface ElementLabel<Text = string | Record<string, string>> {
  text: Text;
  align?: LabelAlign;
  size?: 8 | 12 | 16 | 20 | 24 | 32;
  offset_x?: number;
  offset_y?: number;
}

const LABEL_SIZES = [8, 12, 16, 20, 24, 32];
const LABEL_INSET = 2;
/** A line of the bitmap font is 7 px high at size 8 (its descender row stays below). */
const LABEL_CAP_HEIGHT = 7;

/**
 * The title textarea of a label in an area (Minecraft pixels): centred vertically (or at the
 * top or bottom, `valign`, for a text piece), then aligned and shifted by the offsets.
 * Mirror of `ImageButtonLayout.labelLayer`.
 */
export function labelFrame(
  label: Omit<ElementLabel<unknown>, "text"> & { valign?: "top" | "center" | "bottom" },
  area: { x: number; y: number; width: number; height: number },
) {
  const size = (LABEL_SIZES.includes(label.size ?? 8) ? (label.size ?? 8) : 8) as NonNullable<
    ElementLabel["size"]
  >;
  const alignment: LabelAlign = label.align ?? "center";
  const x =
    alignment === "left"
      ? area.x + LABEL_INSET
      : alignment === "right"
        ? area.x + area.width - LABEL_INSET
        : area.x + Math.floor(area.width / 2);
  const cap = Math.trunc((LABEL_CAP_HEIGHT * size) / 8);
  const y =
    label.valign === "top"
      ? area.y + LABEL_INSET
      : label.valign === "bottom"
        ? area.y + area.height - cap - LABEL_INSET
        : area.y + Math.trunc((area.height - cap) / 2);
  return {
    x: x + (label.offset_x ?? 0),
    y: y + (label.offset_y ?? 0),
    width: area.width,
    lineHeight: size + 2,
    alignment,
    size,
  };
}
