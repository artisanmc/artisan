import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import type { Menu, MenuTitleLayer, PackId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";
import useImage from "use-image";
import { MC_BOTTOM_H, MC_SLOT_STRIDE, MC_TITLE_H, TEX_SCALE } from "../menuLayout";
import { McFontText } from "./McFontText";
import { useTitleSelectionStore } from "./titleSelectionStore";

/**
 * Vanilla MC font ascent in pixels. The plugin renders title text via the
 * bitmap font pipeline where `y` is the baseline; our Konva `<Text>` uses
 * `y = 0` as the top of the layer's coord. To match in-game placement we
 * offset McFontText's `y` by `7 * TEX_SCALE` (ascent → baseline distance)
 * so authors see the same visual position whether or not a font is bound.
 */
const MC_FONT_ASCENT_PX = 7;

/**
 * Vanilla chest GUI title bar dimensions, in MC pixels.
 *
 * The vanilla `generic_54.png` title bar occupies 176 × 17 in the source
 * texture (matching `MC_W` / `MC_TITLE_H` in `menuLayout.ts`). We render at
 * `TEX_SCALE` (2×) so it lines up visually with the rest of the menu canvas.
 */
const TITLE_BAR_W = 176;
const TITLE_BAR_H = 17;
/** Slot grid alignment used when Alt is held during a drag. */
const SLOT_STEP = 18;

/**
 * Pure helper for the drag-end snap logic. Extracted from the component so
 * it can be unit-tested without a Konva stage.
 *
 * Input: raw stage coordinates produced by the dragged node (already in the
 * Stage's pixel space — i.e. multiplied by `TEX_SCALE`).
 *
 * Output: domain coordinates (i.e. divided by `TEX_SCALE`) ready to persist
 * on the layer.
 *
 * Modifiers:
 *  - default        → round to nearest whole pixel
 *  - shift          → keep sub-pixel precision (raw / SCALE, unrounded)
 *  - alt            → snap to multiples of `SLOT_STEP` (18 px = one slot)
 *  - alt + shift    → alt wins
 */
export function snapDragPosition(
  rawStageX: number,
  rawStageY: number,
  scale: number,
  modifiers: { shift: boolean; alt: boolean },
): { x: number; y: number } {
  const rawX = rawStageX / scale;
  const rawY = rawStageY / scale;
  if (modifiers.alt) {
    return {
      x: Math.round(rawX / SLOT_STEP) * SLOT_STEP,
      y: Math.round(rawY / SLOT_STEP) * SLOT_STEP,
    };
  }
  if (modifiers.shift) {
    return { x: rawX, y: rawY };
  }
  return { x: Math.round(rawX), y: Math.round(rawY) };
}

interface LayerNodeProps {
  layer: MenuTitleLayer;
  asset?: Asset;
  /**
   * Font asset resolved by the parent from `layer.fontAssetId` (text layers
   * only). When present, the text body renders via {@link McFontText} using
   * the bitmap glyphs; otherwise we fall back to a plain Konva `<Text>`.
   */
  fontAsset?: Asset;
  text: string;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  /**
   * Y-offset (in stage pixels) applied to `background` layers. When the
   * mockup is in full-chest mode the background should sit just below the
   * title bar, mirroring how the plugin's TitleCompiler pushes the glyph
   * down via negative ascent at runtime. Defaults to 0 (title-bar-only mode).
   */
  bgYOffset?: number;
}

/**
 * Renders one title layer as a Konva Group. The Group is positioned at the
 * layer's `(x, y)` in stage coords (i.e. multiplied by `TEX_SCALE`). For
 * `background` layers there's no x/y on the layer; we pin it at the origin.
 *
 * The shape inside the Group varies by `kind`:
 *  - background       → glyph Image at intrinsic asset size, anchored at (0,0)
 *                       (per plan: backgrounds are "a big glyph" until SP4)
 *  - glyph            → Image at intrinsic asset size (scaled to 2×)
 *  - text             → Text with the resolved i18n string + optional color
 *  - external_glyph   → dashed placeholder Rect (rendered later by plugin)
 */
function LayerNode({
  layer,
  asset,
  fontAsset,
  text,
  selected,
  onSelect,
  onDragEnd,
  bgYOffset = 0,
}: LayerNodeProps) {
  const [image] = useImage(asset ? assetPreviewUrl(asset) : "");

  const groupX = layer.kind === "background" ? 0 : layer.x * TEX_SCALE;
  const groupY = layer.kind === "background" ? bgYOffset : layer.y * TEX_SCALE;

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (layer.kind === "background") return; // bg has no x/y
      const evt = e.evt as DragEvent & { shiftKey: boolean; altKey: boolean };
      const snapped = snapDragPosition(e.target.x(), e.target.y(), TEX_SCALE, {
        shift: Boolean(evt.shiftKey),
        alt: Boolean(evt.altKey),
      });
      // Snap the node back so Konva's internal position matches the
      // committed domain coords (otherwise on subsequent drags it would
      // accumulate sub-pixel drift).
      e.target.position({ x: snapped.x * TEX_SCALE, y: snapped.y * TEX_SCALE });
      onDragEnd(snapped.x, snapped.y);
    },
    [layer.kind, onDragEnd],
  );

  // Per-kind body. Background is non-draggable (no x/y).
  let body: React.ReactNode = null;
  if (layer.kind === "background") {
    // Background is "a big glyph" — rendered at the asset's intrinsic
    // dimensions, anchored at (0,0). Matches the plugin's TitleCompiler
    // which emits `<font:interfaze:default>{ch}</font>` with no offset.
    const w = (asset?.width ?? TITLE_BAR_W) * TEX_SCALE;
    const h = (asset?.height ?? TITLE_BAR_H) * TEX_SCALE;
    body = image ? (
      <KonvaImage image={image} x={0} y={0} width={w} height={h} listening={false} />
    ) : (
      <Rect width={w} height={h} fill="rgba(120,120,120,0.4)" listening={false} />
    );
  } else if (layer.kind === "glyph") {
    const w = (asset?.width ?? 8) * TEX_SCALE;
    const h = (asset?.height ?? 8) * TEX_SCALE;
    body = image ? (
      <KonvaImage image={image} x={0} y={0} width={w} height={h} listening={false} />
    ) : (
      <Rect width={w} height={h} fill="rgba(120,120,120,0.4)" listening={false} />
    );
  } else if (layer.kind === "text") {
    if (fontAsset) {
      // Baseline-relative: McFontText's `y` is the baseline; the Group's y
      // is the layer's top, so we shift the baseline down by the MC font
      // ascent (7 px scaled) to match the plain Konva `<Text>` placement
      // and what the plugin does in-game.
      body = (
        <McFontText
          text={text}
          font={fontAsset}
          x={0}
          y={MC_FONT_ASCENT_PX * TEX_SCALE}
          scale={TEX_SCALE}
        />
      );
    } else {
      body = (
        <Text
          text={text}
          x={0}
          y={0}
          fontSize={7 * TEX_SCALE}
          fontFamily="ui-monospace, monospace"
          fill={layer.color ?? "#404040"}
        />
      );
    }
  } else {
    // external_glyph — runtime resolves these; in the editor we show a
    // dashed placeholder labelled with `provider:glyphName` so the user
    // remembers what's going to render.
    body = (
      <>
        <Rect
          width={10 * TEX_SCALE}
          height={10 * TEX_SCALE}
          fill="rgba(245,158,11,0.15)"
          stroke="#f59e0b"
          strokeWidth={1}
          dash={[2, 2]}
          listening={false}
        />
        <Text
          x={2}
          y={2}
          text={`${layer.provider}:${layer.glyphName}`}
          fontSize={6}
          fill="#f59e0b"
          listening={false}
        />
      </>
    );
  }

  return (
    <Group
      x={groupX}
      y={groupY}
      draggable={layer.kind !== "background"}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={handleDragEnd}
    >
      {body}
      {selected ? (
        // Selection halo — sized to body for glyph/text/external; for bg
        // it spans the whole bar.
        // Note: for text layers (with or without a bound font) we use an
        // approximate width heuristic (`length * 4 * SCALE`). Measuring the
        // real bitmap-glyph advance would require summing glyphMap entries;
        // the heuristic is close enough for an MVP halo.
        <Rect
          x={-1}
          y={-1}
          width={
            layer.kind === "background"
              ? (asset?.width ?? TITLE_BAR_W) * TEX_SCALE + 2
              : layer.kind === "glyph"
                ? (asset?.width ?? 8) * TEX_SCALE + 2
                : layer.kind === "external_glyph"
                  ? 10 * TEX_SCALE + 2
                  : Math.max(text.length * 4 * TEX_SCALE, 8) + 2
          }
          height={
            layer.kind === "background"
              ? (asset?.height ?? TITLE_BAR_H) * TEX_SCALE + 2
              : layer.kind === "glyph"
                ? (asset?.height ?? 8) * TEX_SCALE + 2
                : layer.kind === "external_glyph"
                  ? 10 * TEX_SCALE + 2
                  : 7 * TEX_SCALE + 2
          }
          stroke="#22c55e"
          strokeWidth={1}
          fill="transparent"
          listening={false}
        />
      ) : null}
    </Group>
  );
}

interface TitleMockupProps {
  packId: PackId;
  menu: Menu;
}

/**
 * 2× scaled rendering of a chest title bar, with each `MenuTitleLayer`
 * stacked on top in array order (first = bottom). Layers are draggable
 * (except `background`) and click-selectable; the active selection lives
 * in `useTitleSelectionStore`.
 *
 * The bar shows a dark grey backdrop matching vanilla's title row tint
 * so the user has a visual reference when positioning layers.
 */
export function TitleMockup({ packId, menu }: TitleMockupProps) {
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const selected = useTitleSelectionStore((s) => s.selectedIndex);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const assets = useAssetStore((s) => s.assets);
  const activeLang = useUiStore((s) => s.activeLang);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));

  // When the user adds a background layer, expand the stage to show the
  // entire chest GUI (title bar + N slot rows + bottom inv chrome) so the
  // user sees what their background actually covers in-game. Otherwise we
  // stay compact and only render the title-bar strip.
  const hasBackground = menu.title.some((l) => l.kind === "background");
  const fullChestH = (MC_TITLE_H + menu.rows * MC_SLOT_STRIDE + MC_BOTTOM_H) * TEX_SCALE;
  const stageH = hasBackground ? fullChestH : TITLE_BAR_H * TEX_SCALE;
  // Background glyphs in the plugin are pushed below the title baseline via
  // negative ascent; we mirror that by offsetting the bg Group by MC_TITLE_H.
  const bgYOffset = hasBackground ? MC_TITLE_H * TEX_SCALE : 0;

  return (
    <Stage width={TITLE_BAR_W * TEX_SCALE} height={stageH}>
      <Layer>
        {/* Title-bar backdrop — vanilla MC title row dark grey. Only covers
            the title region; the rest of the stage stays transparent so the
            background glyph (when present) is what the user sees below. */}
        <Rect
          width={TITLE_BAR_W * TEX_SCALE}
          height={TITLE_BAR_H * TEX_SCALE}
          fill="#3f3f3f"
          listening={false}
        />
        {menu.title.map((layer, idx) => {
          const asset =
            layer.kind === "background" || layer.kind === "glyph"
              ? assets.find((a) => a.id === layer.assetId)
              : undefined;
          const fontAsset =
            layer.kind === "text" && layer.fontAssetId
              ? assets.find((a) => a.id === layer.fontAssetId)
              : undefined;
          const text =
            layer.kind === "text" && pack ? getText(pack, layer.value, activeLang) : "";
          return (
            <LayerNode
              // biome-ignore lint/suspicious/noArrayIndexKey: layer order is the stable identifier
              key={idx}
              layer={layer}
              asset={asset}
              fontAsset={fontAsset}
              text={text}
              selected={selected === idx}
              bgYOffset={bgYOffset}
              onSelect={() => setSelected(idx)}
              onDragEnd={(x, y) => {
                // `background` layers have no x/y in the union; the drag
                // handler in `LayerNode` already early-returns for them, so
                // this callback only fires for variants with `x: number;
                // y: number`. Narrow the patch type accordingly so we don't
                // pretend `{ x, y }` is valid for the `background` variant.
                if (layer.kind === "background") return;
                updateLayer({
                  packId,
                  menuId: menu.id,
                  index: idx,
                  patch: { x, y } as Partial<Extract<MenuTitleLayer, { x: number; y: number }>>,
                });
              }}
            />
          );
        })}
      </Layer>
    </Stage>
  );
}
