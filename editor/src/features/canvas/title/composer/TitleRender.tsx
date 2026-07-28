import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import type { MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { getText } from "@/lib/i18n";
import { buildPreviewScope, renderPreview } from "@/features/canvas/menuPreviewScope";
import { useAccountStore } from "@/state/accountStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback, useMemo } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import useImage from "use-image";
import { MC_TITLE_H } from "../../menuLayout";
import { McFontText } from "../McFontText";
import { VanillaMcText, vanillaTextWidth } from "../VanillaMcText";
import { WidthResizeHandle } from "./WidthResizeHandle";
import { snapDragPosition } from "./snap";
import { useTitleLayerDrag } from "./useTitleLayerDrag";

const TAG_RX = /<[^>]+>/g;

/**
 * Counts visible characters (stripped of tags) inside `<bold>` / `<b>` spans.
 * MC bold rendering shifts each glyph 1 px right, adding 1 px to its advance.
 * TS port of TitleCompiler.countBoldChars — match the plugin so wrap output
 * matches what MC actually renders.
 */
function countBoldChars(text: string): number {
  const boldTagPattern = /<\/?(?:bold|b)>/g;
  let inBold = false;
  let count = 0;
  let lastEnd = 0;
  for (const match of text.matchAll(boldTagPattern)) {
    const idx = match.index!;
    if (inBold) {
      count += text.substring(lastEnd, idx).replace(TAG_RX, "").length;
    }
    inBold = !match[0].startsWith("</");
    lastEnd = idx + match[0].length;
  }
  if (inBold) {
    count += text.substring(lastEnd).replace(TAG_RX, "").length;
  }
  return count;
}

/**
 * TS port of TitleCompiler.measureLineWidth — strips MiniMessage tags, sums
 * per-char advances from the CHAR_ADVANCES table (vanilla MC font scan),
 * Used by `wrapLineJs` so width math matches the plugin (and therefore MC).
 */
function measureLineWidthJs(text: string): number {
  return vanillaTextWidth(text.replace(TAG_RX, "")) + countBoldChars(text);
}

/**
 * TS port of TitleCompiler.wrapLine. Splits a single line into sub-lines that
 * fit within maxWidth (MC pixels). Wraps on whitespace; words wider than
 * maxWidth overflow on their own line. MiniMessage tags are stripped for
 * measurement but kept in the output verbatim.
 */
function wrapLineJs(line: string, maxWidth: number): string[] {
  if (line === "") return [""];
  const tokens = line.split(/(?<=\s)|(?=\s)/).filter((t) => t !== "");
  const out: string[] = [];
  let current = "";
  let currentW = 0;
  for (const tok of tokens) {
    const tokW = measureLineWidthJs(tok);
    if (currentW + tokW <= maxWidth) {
      current += tok;
      currentW += tokW;
      continue;
    }
    if (current.trim() === "") {
      out.push(tok.trimEnd());
      current = "";
      currentW = 0;
      continue;
    }
    out.push(current.trimEnd());
    const trimmed = tok.trimStart();
    if (trimmed !== "") {
      current = trimmed;
      currentW = measureLineWidthJs(trimmed);
    } else {
      current = "";
      currentW = 0;
    }
  }
  if (current !== "") {
    const flushed = current.trimEnd();
    if (flushed !== "") out.push(flushed);
  }
  return out.length === 0 ? [""] : out;
}

/** Vanilla chest title bar width, in MC pixels. Matches `MC_W` in menuLayout. */
const TITLE_BAR_W = 176;
/** MC default title label X offset (AbstractContainerScreen.titleLabelX). */
const TITLE_LABEL_X = 8;
/**
 * MC default font ascent. Used to position McFontText's baseline within the
 * text group: baseline = group_origin + BASELINE_Y_PX.
 */
const BASELINE_Y_PX = 7;
/**
 * MC chest GUI title draw Y (AbstractContainerScreen.titleLabelY).
 * TitleCompiler wraps text in `<font:artisan:text_y{Y}>` whose ascent shifts
 * the baseline so the glyph top lands at the desired Y — `layer.y` IS used.
 */
const MC_TITLE_LABEL_Y = 6;
/**
 * Empirically confirmed MC formula: glyph_top = GLYPH_Y_BASE - ascent.
 * Used to position background and glyph layers in the editor so they match
 * exactly what TitleCompiler renders in-game. layer.y is NOT used by the
 * plugin — vertical placement is fully determined by asset.ascent.
 */
const GLYPH_Y_BASE = 13;
/**
 * MC default font character height in pixels. Used as the approximated
 * font size for MiniMessageKonvaText (vector fallback, not pixel-perfect).
 */
const MC_FONT_HEIGHT_PX = 8;

interface TitleRenderProps {
  projectId: ProjectId;
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
export function TitleRender({ projectId, menuId, scale }: TitleRenderProps) {
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  const assets = useAssetStore((s) => s.assets);
  const selectedLayerKey = useUiStore((s) => s.selectedLayerKey);
  const setSelectedLayerKey = useUiStore((s) => s.setSelectedLayerKey);
  const setSelectedMenuId = useUiStore((s) => s.setSelectedMenuId);
  const hiddenLayerKeys = useUiStore((s) => s.hiddenLayerKeys);
  // Preview scope so `{category_name}`-style placeholders in title layers
  // render with the menu's preview context (same scope as the item grid).
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const menuPreviewArgs = useUiStore((s) => s.menuPreviewArgs);
  const previewCtx = useMemo(
    () => (pack && menu ? buildPreviewScope(menu, pack, snapshots, menuPreviewArgs[menuId]) : {}),
    [pack, menu, snapshots, menuPreviewArgs, menuId],
  );

  const onBackdropClick = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Clicking the title-bar area (not on a layer) selects this menu and
      // clears any active title-layer selection (regardless of which menu it
      // belongs to — "click elsewhere = deselect" applies globally).
      // No cancelBubble: MenuGroup's onClick still fires so the menu enters
      // the selection store used by element/drag-out logic.
      setSelectedMenuId(menuId);
      setSelectedLayerKey(null);
    },
    [menuId, setSelectedLayerKey, setSelectedMenuId],
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
          (layer.kind === "text" || layer.kind === "textarea") && layer.fontAssetId
            ? assets.find((a) => a.id === layer.fontAssetId)
            : undefined;
        const text =
          layer.kind === "text" || layer.kind === "plain" || layer.kind === "textarea"
            ? renderPreview(getText(pack, layer.value, activeLang), previewCtx, pack, activeLang)
            : "";
        const selected = selectedLayerKey?.menuId === menuId && selectedLayerKey?.index === idx;

        return (
          <LayerNode
            // biome-ignore lint/suspicious/noArrayIndexKey: layer order is the stable identifier
            key={idx}
            projectId={projectId}
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
  projectId: ProjectId;
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
  projectId: _packId,
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
  const { onPositionChange } = useTitleLayerDrag({ menuId, layerIndex: index });

  // Reference ascent for text layers with a custom font. The maximum ascent
  // across all glyphs determines the topmost rendered pixel: groupY is placed
  // there so the hit area aligns with the actual visual. McFontText is then
  // given `fontRefAscent * scale` as its baseline-y so the highest glyph top
  // lands at y=0 relative to the group.
  // For vanilla text (no fontAsset) this is null and falls back to MC_TITLE_LABEL_Y.
  const fontRefAscent: number | null =
    (layer.kind === "text" || layer.kind === "textarea") && fontAsset?.fontMeta?.glyphMap.length
      ? Math.max(...fontAsset.fontMeta.glyphMap.map((g) => g.ascent))
      : null;

  // Group position. Background and glyph Y are derived from asset.ascent
  // via the empirically confirmed formula: glyph_top = GLYPH_Y_BASE - ascent.
  // Text with a custom font uses the font's max ascent the same way so the
  // group origin aligns with the first visible pixel (enables body-area text).
  // Plain text falls back to MC_TITLE_LABEL_Y.
  const groupX =
    layer.kind === "background"
      ? 0
      : layer.kind === "plain"
        ? TITLE_LABEL_X * scale
        : "x" in layer
          ? layer.x * scale
          : 0;
  const groupY =
    layer.kind === "background"
      ? asset?.ascent != null
        ? (GLYPH_Y_BASE - asset.ascent) * scale
        : MC_TITLE_H * scale
      : layer.kind === "plain"
        ? MC_TITLE_LABEL_Y * scale
        : layer.kind === "text"
          ? fontRefAscent != null
            ? (GLYPH_Y_BASE - fontRefAscent) * scale
            : layer.y * scale
          : layer.kind === "glyph"
            ? asset?.ascent != null
              ? (GLYPH_Y_BASE - asset.ascent) * scale
              : layer.y * scale
            : layer.kind === "textarea"
              ? layer.y * scale
              : "y" in layer
                ? layer.y * scale
                : 0;

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      // Toggle: clicking a selected layer deselects it (lets the user dismiss
      // focus without needing to click the backdrop or an empty slot area).
      if (selected) {
        setSelectedLayerKey(null);
      }
      // When not selected, hit area is listening=false so this never fires.
    },
    [selected, setSelectedLayerKey],
  );

  const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    // Stop the drag from bubbling up to MenuGroup's drag handler — the
    // parent reads `e.target.x()/y()` on dragend and would otherwise apply
    // the layer's coords as the menu's new position. Same pattern as
    // `handleClick` above.
    e.cancelBubble = true;
  }, []);

  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
  }, []);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      // See `handleDragStart` — without this, MenuGroup's onDragEnd fires too
      // and overwrites the menu position with the layer's coords.
      e.cancelBubble = true;
      if (layer.kind === "background" || layer.kind === "plain") return; // no x/y
      const evt = e.evt as DragEvent & { shiftKey: boolean; altKey: boolean };
      const snapped = snapDragPosition(e.target.x(), e.target.y(), scale, {
        shift: Boolean(evt.shiftKey),
        alt: Boolean(evt.altKey),
      });
      // Y is controlled by asset/font ascent for glyphs and custom-font text.
      // Plain text and external_glyph use the dragged Y (free positioning via
      // Y-specific ascii fonts in the resource pack).
      const finalY =
        layer.kind === "text" && fontRefAscent != null
          ? GLYPH_Y_BASE - fontRefAscent
          : layer.kind === "glyph" && asset?.ascent != null
            ? GLYPH_Y_BASE - asset.ascent
            : snapped.y;
      // Snap the node back so Konva's internal position matches the
      // committed domain coords (no sub-pixel drift on subsequent drags).
      e.target.position({ x: snapped.x * scale, y: finalY * scale });
      onPositionChange({ x: snapped.x, y: finalY });
    },
    [layer.kind, asset?.ascent, fontRefAscent, scale, onPositionChange],
  );

  // Intrinsic bounding-box for image-kind layers — drives both the selection
  // outline and the ResizeHandles geometry. Falls back to a sane default when
  // the asset hasn't loaded yet (or is missing).
  const imageW = (asset?.width ?? (layer.kind === "background" ? TITLE_BAR_W : 8)) * scale;
  const imageH = (asset?.height ?? (layer.kind === "background" ? MC_TITLE_H : 8)) * scale;

  const textareaLines =
    layer.kind === "textarea"
      ? // Trim leading whitespace from the whole content so the first sub-line
        // doesn't carry accidental leading spaces (matches the plugin runtime).
        // Internal indentation after explicit `\n` is preserved.
        text
          .replace(/^\s+/, "")
          .split("\n")
          .flatMap((l) => wrapLineJs(l, Math.floor((layer.width * 8) / (layer.size ?? 8))))
      : [];
  const textareaBoxW = layer.kind === "textarea" ? layer.width : 0;
  // Alignment-aware x offset for the bbox/hit/handle: the textarea's lines
  // render at relative x = 0 (left), -width/2 (center), or -width (right).
  // The bounding box needs to follow the same offset so it actually wraps
  // around the visible text.
  const textareaBoxOffsetX =
    layer.kind === "textarea"
      ? layer.alignment === "center"
        ? -layer.width / 2
        : layer.alignment === "right"
          ? -layer.width
          : 0
      : 0;
  const textareaTotalH =
    layer.kind === "textarea" ? Math.max(1, textareaLines.length) * layer.lineHeight : 0;

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
        y={fontRefAscent != null ? fontRefAscent * scale : BASELINE_Y_PX * scale}
        scale={scale}
        listening={false}
      />
    ) : (
      <VanillaMcText
        source={text}
        x={0}
        y={0}
        scale={scale}
        sizeScale={(layer.size ?? 8) / 8}
        defaultColor="#404040"
        listening={false}
      />
    );
  } else if (layer.kind === "plain") {
    body = (
      <VanillaMcText
        source={text}
        x={0}
        y={0}
        scale={scale}
        defaultColor="#404040"
        listening={false}
      />
    );
  } else if (layer.kind === "textarea") {
    // Match the plugin: trim leading whitespace from the whole content so
    // the first sub-line doesn't carry accidental leading spaces. Internal
    // indentation after explicit `\n` is preserved.
    const hardLines = text.replace(/^\s+/, "").split("\n");
    const lines = hardLines.flatMap((l) =>
      wrapLineJs(l, Math.floor((layer.width * 8) / (layer.size ?? 8))),
    );
    body = (
      <>
        {lines.map((line, i) => {
          const lineWidth = vanillaTextWidth(line);
          const lineX =
            layer.alignment === "center"
              ? -(lineWidth / 2) * scale
              : layer.alignment === "right"
                ? -lineWidth * scale
                : 0;
          const lineY = i * layer.lineHeight * scale;
          return fontAsset ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable visual order
            <McFontText
              key={i}
              text={line}
              font={fontAsset}
              x={lineX}
              y={lineY + (fontRefAscent != null ? fontRefAscent * scale : BASELINE_Y_PX * scale)}
              scale={scale}
              listening={false}
            />
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable visual order
            <VanillaMcText
              key={i}
              source={line}
              x={lineX}
              y={lineY}
              scale={scale}
              sizeScale={(layer.size ?? 8) / 8}
              defaultColor="#404040"
              listening={false}
            />
          );
        })}
      </>
    );
  } else if (layer.kind === "external_glyph") {
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

  // Drag is only active when the layer is selected. Unselected layers are
  // click-through: events fall to the backdrop (which deselects) or the
  // underlying menu. This preserves menu clickability.
  const draggable = selected && layer.kind !== "background";

  // Scale factor for text/textarea layers based on their `size` property.
  // size=8 (default) → sizeScale=1, size=16 → sizeScale=2, etc.
  // `plain` has no `size` field (it's a legacy kind without per-layer sizing).
  const layerSizeScale =
    layer.kind === "text" || layer.kind === "textarea" ? (layer.size ?? 8) / 8 : 1;

  // Bounding-box dimensions — used for the selection outline and hit area.
  const outlineW =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageW
      : layer.kind === "external_glyph"
        ? 10 * scale
        : layer.kind === "textarea"
          ? textareaBoxW * scale * layerSizeScale
          : Math.max(vanillaTextWidth(text) * scale * layerSizeScale, 8);
  const outlineH =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageH
      : layer.kind === "external_glyph"
        ? 10 * scale
        : layer.kind === "textarea"
          ? textareaTotalH * scale * layerSizeScale
          : MC_FONT_HEIGHT_PX * scale * layerSizeScale;

  // All layer kinds need an explicit hit area: KonvaImage has listening={false}
  // (so glyph/background Groups have no listening child), text hit-tests on
  // rendered glyphs only (gaps break drag pickup), and external_glyph uses
  // listening={false} on every child.
  //
  // We render an almost-transparent Rect sized to the layer's bounding box
  // BEFORE the visible body so Konva picks it up on mousedown anywhere
  // inside the outline (drag works, click selects). The same trick is used
  // for the title-bar backdrop above.
  const hitW =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageW
      : layer.kind === "text" || layer.kind === "plain"
        ? Math.max(vanillaTextWidth(text) * scale * layerSizeScale, 8)
        : layer.kind === "textarea"
          ? textareaBoxW * scale * layerSizeScale
          : 10 * scale;
  const hitH =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageH
      : layer.kind === "text" || layer.kind === "plain"
        ? MC_FONT_HEIGHT_PX * scale * layerSizeScale
        : layer.kind === "textarea"
          ? textareaTotalH * scale * layerSizeScale
          : 10 * scale;

  return (
    <Group
      x={groupX}
      y={groupY}
      draggable={draggable}
      onClick={handleClick}
      onTap={handleClick}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      {/* Hit area — only listening when selected. Unselected layers are
          click-through so the underlying menu remains reachable. When
          selected, this Rect captures pointer events for drag and click. */}
      <Rect
        x={textareaBoxOffsetX * scale}
        y={0}
        width={hitW}
        height={hitH}
        fill="rgba(0,0,0,0.001)"
        listening={selected}
      />
      {body}
      {selected ? (
        <>
          {/* Yellow 1-px stroke around the bounding box. Matches the v3 design
              spec (was emerald in v2). */}
          <Rect
            x={textareaBoxOffsetX * scale - 1}
            y={-1}
            width={outlineW + 2}
            height={outlineH + 2}
            stroke="#eab308"
            strokeWidth={1}
            fill="transparent"
            listening={false}
          />
          {layer.kind === "textarea" ? (
            <WidthResizeHandle
              x={(textareaBoxOffsetX + layer.width) * scale}
              y={0}
              height={outlineH}
              currentWidth={layer.width}
              scale={scale}
              onResize={(newWidth) => {
                useAccountStore.getState().updateMenuTitleLayer({
                  projectId: _packId,
                  menuId,
                  index,
                  patch: { width: newWidth } as Partial<MenuTitleLayer>,
                });
              }}
            />
          ) : null}
        </>
      ) : null}
    </Group>
  );
}

