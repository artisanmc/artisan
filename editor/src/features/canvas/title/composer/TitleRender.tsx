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
import { ResizeHandles } from "./ResizeHandles";
import { snapDragPosition } from "./snap";
import { useTitleLayerDrag } from "./useTitleLayerDrag";

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
}

/**
 * Stage-less Konva subtree that renders a menu's title layers — title-bar
 * backdrop + every layer in array order (first = bottom). Designed to live
 * inside an existing `<Stage><Layer>`; the caller owns Stage sizing.
 *
 * Always interactive (v3): clicks on layers select them via
 * `uiStore.selectedLayerKey`, drags update positions via `useTitleLayerDrag`,
 * and image layers expose `ResizeHandles` when selected. Clicks on the
 * title-bar grey backdrop (non-layer area) clear the selection.
 *
 * Layer body rendering matches the plugin runtime:
 *  - background → big glyph anchored below the title bar (matches negative
 *    ascent push in TitleCompiler)
 *  - glyph → image at intrinsic asset size, scaled
 *  - text → McFontText (bitmap font, if `fontAssetId` bound) or
 *    MiniMessageKonvaText (vector fallback)
 *  - external_glyph → dashed amber placeholder until SP5
 */
export function TitleRender({ packId, menuId, scale }: TitleRenderProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  const assets = useAssetStore((s) => s.assets);
  const selectedLayerKey = useUiStore((s) => s.selectedLayerKey);
  const setSelectedLayerKey = useUiStore((s) => s.setSelectedLayerKey);
  const setSelectedMenuId = useUiStore((s) => s.setSelectedMenuId);
  const hiddenLayerKeys = useUiStore((s) => s.hiddenLayerKeys);

  const onBackdropClick = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Clicking the grey title-bar area (anywhere not on a layer):
      //   1. Makes this menu the selected one in `uiStore` (v3 — drives
      //      LayersPanel and the sticky lastSelectedMenuId mirror).
      //   2. Clears any title-layer selection that belonged to this menu
      //      (matches the v2 "click empty area = deselect layer" feel).
      // We deliberately do NOT cancelBubble — MenuGroup's parent onClick
      // still needs to fire so the menu becomes the selectionStore selection
      // (used by element selection / drag-out logic). Both stores end up
      // pointing at this menu after a title-bar click.
      setSelectedMenuId(menuId);
      if (selectedLayerKey?.menuId === menuId) {
        setSelectedLayerKey(null);
      }
    },
    [menuId, selectedLayerKey, setSelectedLayerKey, setSelectedMenuId],
  );

  if (!pack || !menu) return null;

  return (
    <>
      {/* Title-bar backdrop — invisible hit area covering the chest's title
          row. Vanilla MC chests don't paint a gray block here (the title
          text floats directly over the wood texture), so we keep the Rect
          for click/tap detection but use an almost-transparent fill so
          Konva's hit-testing still picks it up while the user sees the
          underlying texture unchanged.
          (`fill="transparent"` works too, but a near-zero-alpha fill is
          maximally portable across Konva versions.) */}
      <Rect
        x={0}
        y={0}
        width={TITLE_BAR_W * scale}
        height={MC_TITLE_H * scale}
        fill="rgba(0,0,0,0.001)"
        onClick={onBackdropClick}
        onTap={onBackdropClick}
      />
      {menu.title.map((layer, idx) => {
        const hidden = hiddenLayerKeys.has(`${menuId}:${idx}`);
        if (hidden) return null;
        const asset =
          layer.kind === "background" || layer.kind === "glyph"
            ? assets.find((a) => a.id === layer.assetId)
            : undefined;
        const fontAsset =
          layer.kind === "text" && layer.fontAssetId
            ? assets.find((a) => a.id === layer.fontAssetId)
            : undefined;
        const text = layer.kind === "text" ? getText(pack, layer.value, activeLang) : "";
        const selected =
          selectedLayerKey?.menuId === menuId && selectedLayerKey?.index === idx;

        return (
          <LayerNode
            // biome-ignore lint/suspicious/noArrayIndexKey: layer order is the stable identifier
            key={idx}
            packId={packId}
            menuId={menuId}
            layer={layer}
            index={idx}
            scale={scale}
            asset={asset}
            fontAsset={fontAsset}
            text={text}
            selected={selected}
          />
        );
      })}
    </>
  );
}

interface LayerNodeProps {
  packId: PackId;
  menuId: MenuId;
  layer: MenuTitleLayer;
  index: number;
  scale: number;
  asset?: Asset;
  fontAsset?: Asset;
  text: string;
  selected: boolean;
}

function LayerNode({
  packId: _packId,
  menuId,
  layer,
  index,
  scale,
  asset,
  fontAsset,
  text,
  selected,
}: LayerNodeProps) {
  const [image] = useImage(asset ? assetPreviewUrl(asset) : "");
  const setSelectedLayerKey = useUiStore((s) => s.setSelectedLayerKey);
  const { onPositionChange, onResize, onResizeEnd } = useTitleLayerDrag({
    menuId,
    layerIndex: index,
  });

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

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Stop the click from bubbling up to the menu's own click handler —
      // selecting a layer should not also select/move the parent menu.
      e.cancelBubble = true;
      setSelectedLayerKey({ menuId, index });
    },
    [menuId, index, setSelectedLayerKey],
  );

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (layer.kind === "background") return; // bg has no x/y
      const evt = e.evt as DragEvent & { shiftKey: boolean; altKey: boolean };
      const snapped = snapDragPosition(e.target.x(), e.target.y(), scale, {
        shift: Boolean(evt.shiftKey),
        alt: Boolean(evt.altKey),
      });
      // Snap the node back so Konva's internal position matches the
      // committed domain coords (no sub-pixel drift on subsequent drags).
      e.target.position({ x: snapped.x * scale, y: snapped.y * scale });
      onPositionChange({ x: snapped.x, y: snapped.y });
    },
    [layer.kind, scale, onPositionChange],
  );

  // Intrinsic bounding-box for image-kind layers — drives both the selection
  // outline and the ResizeHandles geometry. Falls back to a sane default when
  // the asset hasn't loaded yet (or is missing).
  const imageW =
    (asset?.width ?? (layer.kind === "background" ? TITLE_BAR_W : 8)) * scale;
  const imageH =
    (asset?.height ?? (layer.kind === "background" ? MC_TITLE_H : 8)) * scale;

  // Per-kind body. Background and glyph share the image path.
  let body: React.ReactNode = null;
  if (layer.kind === "background" || layer.kind === "glyph") {
    body = image ? (
      <KonvaImage image={image} x={0} y={0} width={imageW} height={imageH} listening={false} />
    ) : (
      <Rect width={imageW} height={imageH} fill="rgba(120,120,120,0.4)" listening={false} />
    );
  } else if (layer.kind === "text") {
    body = fontAsset ? (
      <McFontText
        text={text}
        font={fontAsset}
        x={0}
        y={BASELINE_Y_PX * scale}
        scale={scale}
        listening={false}
      />
    ) : (
      <MiniMessageKonvaText
        source={text}
        x={0}
        y={0}
        fontSize={BASELINE_Y_PX * scale}
        defaultColor="#404040"
        listening={false}
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

  // Background can't be dragged (no x/y in domain), other layers are.
  const draggable = layer.kind !== "background";

  // Selection outline dimensions — match the body's intrinsic box.
  const outlineW =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageW
      : layer.kind === "external_glyph"
        ? 10 * scale
        : Math.max(text.length * 4 * scale, 8);
  const outlineH =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageH
      : layer.kind === "external_glyph"
        ? 10 * scale
        : 7 * scale;

  // ResizeHandles only render for selected image-kind layers (background or
  // glyph). Other kinds don't have a meaningful "resize" semantic in v3.
  const showResizeHandles =
    selected && (layer.kind === "background" || layer.kind === "glyph");

  // Text and external_glyph bodies don't form a reliable hit area — text
  // hit-tests on rendered glyphs only (sub-pixel gaps between letters break
  // Konva's drag pickup), and the external_glyph placeholder uses
  // `listening={false}` on every child. Without a backing hit area, Group's
  // `draggable` triggers nowhere and the user can't move the layer.
  //
  // We render an almost-transparent Rect sized to the layer's bounding box
  // BEFORE the visible body so Konva picks it up on mousedown anywhere
  // inside the outline (drag works, click selects). The same trick is used
  // for the title-bar backdrop above.
  const needsHitArea = layer.kind === "text" || layer.kind === "external_glyph";
  const hitW =
    layer.kind === "text"
      ? Math.max(text.length * 4 * scale, 8)
      : layer.kind === "external_glyph"
        ? 10 * scale
        : 0;
  const hitH =
    layer.kind === "text"
      ? 7 * scale
      : layer.kind === "external_glyph"
        ? 10 * scale
        : 0;

  return (
    <Group
      x={groupX}
      y={groupY}
      draggable={draggable}
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {needsHitArea ? (
        // Hit area at z=0 — under the visible body so it doesn't obscure
        // anything, but listening={true} (default) so it captures pointer
        // events on the whole bounding box. Near-zero-alpha fill keeps it
        // invisible while still hit-testable.
        <Rect
          x={0}
          y={0}
          width={hitW}
          height={hitH}
          fill="rgba(0,0,0,0.001)"
        />
      ) : null}
      {body}
      {selected ? (
        // Yellow 1-px stroke around the bounding box. Matches the v3 design
        // spec (was emerald in v2).
        <Rect
          x={-1}
          y={-1}
          width={outlineW + 2}
          height={outlineH + 2}
          stroke="#eab308"
          strokeWidth={1}
          fill="transparent"
          listening={false}
        />
      ) : null}
      {showResizeHandles ? (
        <ResizeHandles
          x={0}
          y={0}
          width={outlineW}
          height={outlineH}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
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
