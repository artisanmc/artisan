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
import { useTitleSelectionStore } from "./titleSelectionStore";

/**
 * Vanilla chest GUI title bar dimensions, in MC pixels.
 *
 * The vanilla `generic_54.png` title bar is 176 × 16. We render at 2× scale
 * so it lines up visually with our other Konva surfaces (also 2× per
 * `TEX_SCALE`).
 */
const WIDTH = 176;
const HEIGHT = 16;
const SCALE = 2;
/** Slot grid alignment used when Alt is held during a drag. */
const SLOT_STEP = 18;

/**
 * Pure helper for the drag-end snap logic. Extracted from the component so
 * it can be unit-tested without a Konva stage.
 *
 * Input: raw stage coordinates produced by the dragged node (already in the
 * Stage's pixel space — i.e. multiplied by `SCALE`).
 *
 * Output: domain coordinates (i.e. divided by `SCALE`) ready to persist on
 * the layer.
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
  index: number;
  asset?: Asset;
  text: string;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
}

/**
 * Renders one title layer as a Konva Group. The Group is positioned at the
 * layer's `(x, y)` in stage coords (i.e. multiplied by `SCALE`). For
 * `background` layers there's no x/y on the layer; we pin it at the origin.
 *
 * The shape inside the Group varies by `kind`:
 *  - background       → full-bar Image (or grey placeholder if asset missing)
 *  - glyph            → Image at intrinsic asset size (scaled to 2×)
 *  - text             → Text with the resolved i18n string + optional color
 *  - external_glyph   → dashed placeholder Rect (rendered later by plugin)
 */
function LayerNode({ layer, index: _index, asset, text, selected, onSelect, onDragEnd }: LayerNodeProps) {
  const [image] = useImage(asset ? assetPreviewUrl(asset) : "");

  const groupX = layer.kind === "background" ? 0 : layer.x * SCALE;
  const groupY = layer.kind === "background" ? 0 : layer.y * SCALE;

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (layer.kind === "background") return; // bg has no x/y
      const evt = e.evt as DragEvent & { shiftKey: boolean; altKey: boolean };
      const snapped = snapDragPosition(e.target.x(), e.target.y(), SCALE, {
        shift: Boolean(evt.shiftKey),
        alt: Boolean(evt.altKey),
      });
      // Snap the node back so Konva's internal position matches the
      // committed domain coords (otherwise on subsequent drags it would
      // accumulate sub-pixel drift).
      e.target.position({ x: snapped.x * SCALE, y: snapped.y * SCALE });
      onDragEnd(snapped.x, snapped.y);
    },
    [layer.kind, onDragEnd],
  );

  // Per-kind body. Background is non-draggable (no x/y).
  let body: React.ReactNode = null;
  if (layer.kind === "background") {
    body = image ? (
      <KonvaImage image={image} x={0} y={0} width={WIDTH * SCALE} height={HEIGHT * SCALE} listening={false} />
    ) : (
      <Rect width={WIDTH * SCALE} height={HEIGHT * SCALE} fill="#5a5a5a" listening={false} />
    );
  } else if (layer.kind === "glyph") {
    const w = (asset?.width ?? 8) * SCALE;
    const h = (asset?.height ?? 8) * SCALE;
    body = image ? (
      <KonvaImage image={image} x={0} y={0} width={w} height={h} listening={false} />
    ) : (
      <Rect width={w} height={h} fill="rgba(120,120,120,0.4)" listening={false} />
    );
  } else if (layer.kind === "text") {
    body = (
      <Text
        text={text}
        x={0}
        y={0}
        fontSize={7 * SCALE}
        fontFamily="ui-monospace, monospace"
        fill={layer.color ?? "#404040"}
      />
    );
  } else {
    // external_glyph — runtime resolves these; in the editor we show a
    // dashed placeholder labelled with `provider:glyphName` so the user
    // remembers what's going to render.
    body = (
      <>
        <Rect
          width={10 * SCALE}
          height={10 * SCALE}
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
        <Rect
          x={-1}
          y={-1}
          width={
            layer.kind === "background"
              ? WIDTH * SCALE + 2
              : layer.kind === "glyph"
                ? (asset?.width ?? 8) * SCALE + 2
                : layer.kind === "external_glyph"
                  ? 10 * SCALE + 2
                  : Math.max(text.length * 4 * SCALE, 8) + 2
          }
          height={
            layer.kind === "background"
              ? HEIGHT * SCALE + 2
              : layer.kind === "glyph"
                ? (asset?.height ?? 8) * SCALE + 2
                : layer.kind === "external_glyph"
                  ? 10 * SCALE + 2
                  : 7 * SCALE + 2
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

  return (
    <Stage width={WIDTH * SCALE} height={HEIGHT * SCALE}>
      <Layer>
        {/* Title-bar backdrop — vanilla MC title row dark grey. */}
        <Rect width={WIDTH * SCALE} height={HEIGHT * SCALE} fill="#3f3f3f" listening={false} />
        {menu.title.map((layer, idx) => {
          const asset =
            layer.kind === "background" || layer.kind === "glyph"
              ? assets.find((a) => a.id === layer.assetId)
              : undefined;
          const text =
            layer.kind === "text" && pack ? getText(pack, layer.value, activeLang) : "";
          return (
            <LayerNode
              // biome-ignore lint/suspicious/noArrayIndexKey: layer order is the stable identifier
              key={idx}
              layer={layer}
              index={idx}
              asset={asset}
              text={text}
              selected={selected === idx}
              onSelect={() => setSelected(idx)}
              onDragEnd={(x, y) =>
                updateLayer({
                  packId,
                  menuId: menu.id,
                  index: idx,
                  patch: { x, y } as Partial<MenuTitleLayer>,
                })
              }
            />
          );
        })}
      </Layer>
    </Stage>
  );
}
