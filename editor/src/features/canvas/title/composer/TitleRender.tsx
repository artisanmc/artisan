import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import type { MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { getText } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import useImage from "use-image";
import { MC_BOTTOM_H, MC_SLOT_STRIDE, MC_TITLE_H } from "../../menuLayout";
import { MiniMessageKonvaText } from "../../MiniMessageKonvaText";
import { McFontText } from "../McFontText";
import { snapDragPosition } from "./snap";

/** Vanilla chest title bar width, in MC pixels. Matches `MC_W` in menuLayout. */
const TITLE_BAR_W = 176;
/** MC default font ascent — used to push McFontText's baseline down to match
 *  the plugin's runtime placement. */
const BASELINE_Y_PX = 7;

interface TitleRenderProps {
  packId: PackId;
  menuId: MenuId;
  /** Pixel scale (e.g. 2 for the title canvas, smaller for thumbnails). */
  scale: number;
  /** `compact` = read-only render for the pack canvas (no drag, no click);
   *  `edit` = interactive focus-mode composer. */
  mode: "compact" | "edit";
  /** Index of the layer currently selected (highlights with a green halo).
   *  Only meaningful in `edit` mode. */
  selectedIndex?: number;
  /** Fired when a non-background layer is clicked. Edit mode only. */
  onLayerClick?: (index: number) => void;
  /** Fired when a non-background layer drag ends. `x` and `y` are domain
   *  coords (already divided by scale + snapped). Edit mode only. */
  onLayerDragEnd?: (index: number, x: number, y: number) => void;
}

/**
 * Stage-less Konva subtree that renders a menu's title layers — title-bar
 * backdrop + every layer in array order (first = bottom). Designed to live
 * inside an existing `<Stage><Layer>`; the caller owns Stage sizing.
 *
 * Shared by:
 *  - `MenuGroup` (pack canvas) — `mode="compact"`, read-only
 *  - `ComposerCanvas` (focus mode) — `mode="edit"`, draggable + clickable
 *
 * Layer body rendering matches the plugin runtime:
 *  - background → big glyph anchored below the title bar (matches negative
 *    ascent push in TitleCompiler)
 *  - glyph → image at intrinsic asset size, scaled
 *  - text → McFontText (bitmap font, if `fontAssetId` bound) or
 *    MiniMessageKonvaText (vector fallback)
 *  - external_glyph → dashed amber placeholder until SP5
 */
export function TitleRender({
  packId,
  menuId,
  scale,
  mode,
  selectedIndex,
  onLayerClick,
  onLayerDragEnd,
}: TitleRenderProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  const assets = useAssetStore((s) => s.assets);

  if (!pack || !menu) return null;

  return (
    <>
      {/* Title-bar grey backdrop — vanilla MC title row tint. */}
      <Rect
        x={0}
        y={0}
        width={TITLE_BAR_W * scale}
        height={MC_TITLE_H * scale}
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
        const text = layer.kind === "text" ? getText(pack, layer.value, activeLang) : "";

        return (
          <LayerNode
            // biome-ignore lint/suspicious/noArrayIndexKey: layer order is the stable identifier
            key={idx}
            layer={layer}
            index={idx}
            scale={scale}
            mode={mode}
            asset={asset}
            fontAsset={fontAsset}
            text={text}
            selected={selectedIndex === idx}
            onLayerClick={onLayerClick}
            onLayerDragEnd={onLayerDragEnd}
          />
        );
      })}
    </>
  );
}

interface LayerNodeProps {
  layer: MenuTitleLayer;
  index: number;
  scale: number;
  mode: "compact" | "edit";
  asset?: Asset;
  fontAsset?: Asset;
  text: string;
  selected: boolean;
  onLayerClick?: (index: number) => void;
  onLayerDragEnd?: (index: number, x: number, y: number) => void;
}

function LayerNode({
  layer,
  index,
  scale,
  mode,
  asset,
  fontAsset,
  text,
  selected,
  onLayerClick,
  onLayerDragEnd,
}: LayerNodeProps) {
  const [image] = useImage(asset ? assetPreviewUrl(asset) : "");

  // Group position. Background pins below the title bar (matches the plugin
  // runtime which uses negative ascent to push the glyph down). Other layers
  // use their explicit (x, y) in domain coords.
  const groupX = layer.kind === "background" ? 0 : "x" in layer ? layer.x * scale : 0;
  const groupY =
    layer.kind === "background"
      ? MC_TITLE_H * scale
      : "y" in layer
        ? layer.y * scale
        : 0;

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (mode !== "edit") return;
      if (layer.kind === "background") return; // bg has no x/y
      const evt = e.evt as DragEvent & { shiftKey: boolean; altKey: boolean };
      const snapped = snapDragPosition(e.target.x(), e.target.y(), scale, {
        shift: Boolean(evt.shiftKey),
        alt: Boolean(evt.altKey),
      });
      // Snap the node back so Konva's internal position matches the
      // committed domain coords (no sub-pixel drift on subsequent drags).
      e.target.position({ x: snapped.x * scale, y: snapped.y * scale });
      onLayerDragEnd?.(index, snapped.x, snapped.y);
    },
    [mode, layer.kind, scale, index, onLayerDragEnd],
  );

  // Per-kind body. Background and glyph share the image path.
  let body: React.ReactNode = null;
  if (layer.kind === "background" || layer.kind === "glyph") {
    const w =
      (asset?.width ?? (layer.kind === "background" ? TITLE_BAR_W : 8)) * scale;
    const h =
      (asset?.height ?? (layer.kind === "background" ? MC_TITLE_H : 8)) * scale;
    body = image ? (
      <KonvaImage image={image} x={0} y={0} width={w} height={h} listening={false} />
    ) : (
      <Rect width={w} height={h} fill="rgba(120,120,120,0.4)" listening={false} />
    );
  } else if (layer.kind === "text") {
    body = fontAsset ? (
      <McFontText
        text={text}
        font={fontAsset}
        x={0}
        y={BASELINE_Y_PX * scale}
        scale={scale}
      />
    ) : (
      <MiniMessageKonvaText
        source={text}
        x={0}
        y={0}
        fontSize={BASELINE_Y_PX * scale}
        defaultColor="#404040"
      />
    );
  } else {
    // external_glyph — runtime resolves these; in the editor we show a
    // dashed placeholder labelled with `provider:glyphName` (SP5 will do
    // proper rendering).
    body = (
      <>
        <Rect
          width={10 * scale}
          height={10 * scale}
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

  const interactive = mode === "edit" && layer.kind !== "background";

  return (
    <Group
      x={groupX}
      y={groupY}
      draggable={interactive}
      listening={mode === "edit"}
      onClick={mode === "edit" ? () => onLayerClick?.(index) : undefined}
      onTap={mode === "edit" ? () => onLayerClick?.(index) : undefined}
      onDragEnd={handleDragEnd}
    >
      {body}
      {selected ? (
        // Selection halo. For text we use the same heuristic as TitleMockup
        // (`length * 4 * scale`) — exact bitmap measurement is deferred.
        <Rect
          x={-1}
          y={-1}
          width={
            layer.kind === "background" || layer.kind === "glyph"
              ? (asset?.width ?? (layer.kind === "background" ? TITLE_BAR_W : 8)) *
                  scale +
                2
              : layer.kind === "external_glyph"
                ? 10 * scale + 2
                : Math.max(text.length * 4 * scale, 8) + 2
          }
          height={
            layer.kind === "background" || layer.kind === "glyph"
              ? (asset?.height ?? (layer.kind === "background" ? MC_TITLE_H : 8)) *
                  scale +
                2
              : layer.kind === "external_glyph"
                ? 10 * scale + 2
                : 7 * scale + 2
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

/**
 * Stage height (in pixels) needed to display this menu's title. When a
 * background layer is present we return the full chest height so the user
 * sees where the background glyph extends (it spills below the title bar
 * via negative-ascent push). Otherwise just the title bar strip.
 */
export function titleRenderHeight(
  menu: { rows: number; title: MenuTitleLayer[] },
  scale: number,
): number {
  const hasBackground = menu.title.some((l) => l.kind === "background");
  if (!hasBackground) return MC_TITLE_H * scale;
  return (MC_TITLE_H + menu.rows * MC_SLOT_STRIDE + MC_BOTTOM_H) * scale;
}
