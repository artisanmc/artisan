import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import { menusOf } from "@/domain/documents";
import { elementLabels } from "@/domain/imageButton";
import type { MenuId, MenuTitleLayer, Project, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { buildPreviewScope, renderPreview } from "@/features/canvas/menuPreviewScope";
import { getText } from "@/lib/i18n";
import { plainTextFromMiniMessage } from "@/lib/miniMessage";
import { useAuthenticatedImage } from "@/lib/useAuthenticatedImage";
import { useImageButtonDragStore } from "@/state/imageButtonDragStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback, useMemo } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { type PickBox, applyPick, coversWindow } from "../../canvasPick";
import { MC_TITLE_H, MC_W } from "../../menuLayout";
import { McFontText } from "../McFontText";
import { VanillaMcText, vanillaTextWidth } from "../VanillaMcText";
import { WidthResizeHandle } from "./WidthResizeHandle";
import { snapDragPosition } from "./snap";
import { asTextFrame, patchTextFrame, textAnchorOffset } from "./textFrame";
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
 * Backgrounds sit at their asset's ascent. Glyph layers carry their own Y:
 * the plugin draws them through a `glyph_y{Y}` font whose ascent is 13 - Y,
 * which MC only accepts while ascent <= height — so Y >= 13 - height.
 */
const GLYPH_Y_BASE = 13;
/**
 * MC default font character height in pixels. Used as a text layer's line
 * height for its outline and hit area.
 */
const MC_FONT_HEIGHT_PX = 8;

/** Where MC draws a glyph layer: its Y, but never above 13 - height. */
function glyphY(y: number, asset: Asset | undefined): number {
  return asset ? Math.max(y, GLYPH_Y_BASE - asset.height) : y;
}

/**
 * Where a title layer sits on the canvas, in scaled px: its group origin (`x`, `y`) and its
 * outline (`width`, `height`), with the measures the layer's drawing reuses.
 */
export function titleLayerBox(
  layer: MenuTitleLayer,
  asset: Asset | undefined,
  fontAsset: Asset | undefined,
  text: string,
  scale: number,
) {
  const textFrame = layer.kind === "text" || layer.kind === "textarea" ? asTextFrame(layer) : null;
  const anchorOffset = textFrame ? textAnchorOffset(textFrame) : 0;

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
          ? (layer.x - anchorOffset) * scale
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
            ? glyphY(layer.y, asset) * scale
            : layer.kind === "textarea"
              ? layer.y * scale
              : "y" in layer
                ? layer.y * scale
                : 0;

  // Intrinsic bounding-box for image-kind layers — drives the selection
  // outline. Falls back to a sane default when
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
  const textareaTotalH =
    layer.kind === "textarea"
      ? Math.max(0, textareaLines.length - 1) * layer.lineHeight +
        Math.max(layer.lineHeight, layer.size ?? 8)
      : 0;

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
        : textFrame
          ? textFrame.width * scale
          : Math.max(vanillaTextWidth(text) * scale * layerSizeScale, 8);
  const outlineH =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageH
      : layer.kind === "external_glyph"
        ? 10 * scale
        : layer.kind === "textarea"
          ? textareaTotalH * scale
          : MC_FONT_HEIGHT_PX * scale * layerSizeScale;
  // What a click may hit: the text itself, not its whole frame. A one-line `text` has a
  // 168 px frame whatever it says, so the frame of "Day 4" would cover the buttons right of it.
  let pickX = groupX;
  let pickW = outlineW;
  if (textFrame && !fontAsset) {
    const lines = layer.kind === "textarea" ? textareaLines : [text];
    const ink = Math.max(
      8,
      ...lines.map((l) => vanillaTextWidth(plainTextFromMiniMessage(l)) * scale * layerSizeScale),
    );
    if (ink < outlineW) {
      const free = outlineW - ink;
      pickX +=
        textFrame.alignment === "center"
          ? Math.floor(free / 2)
          : textFrame.alignment === "right"
            ? free
            : 0;
      pickW = ink;
    }
  }
  return {
    x: groupX,
    y: groupY,
    width: outlineW,
    height: outlineH,
    pickX,
    pickWidth: pickW,
    anchorOffset,
    fontRefAscent,
    imageW,
    imageH,
    textareaLines,
    textareaTotalH,
    layerSizeScale,
  };
}

/** What drawing a title layer needs: its image or font asset, and its previewed text. */
function layerInputs(
  layer: MenuTitleLayer,
  assets: readonly Asset[],
  project: Project,
  activeLang: string,
  previewCtx: Record<string, unknown>,
) {
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
      ? renderPreview(getText(project, layer.value, activeLang), previewCtx, project, activeLang)
      : "";
  return { asset, fontAsset, text };
}

/**
 * The boxes (scaled px) of a menu's visible title layers, for picking what lies under a
 * point; a layer covering the window is not `pickable` by a plain click.
 */
export function useTitleLayerBoxes(projectId: ProjectId, menuId: MenuId, scale: number): PickBox[] {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const menu = menusOf(project).find((m) => m.id === menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  const assets = useAssetStore((s) => s.assets);
  const hiddenLayerKeys = useUiStore((s) => s.hiddenLayerKeys);
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const previewArgs = useUiStore((s) => s.menuPreviewArgs[menuId]);
  return useMemo(() => {
    if (!project || !menu) return [];
    const previewCtx = buildPreviewScope(menu, project, snapshots, previewArgs);
    const window = { width: MC_W * scale, height: (MC_TITLE_H + menu.rows * 18) * scale };
    return menu.title.flatMap((layer, index) => {
      if (hiddenLayerKeys.has(`${menuId}:${index}`)) return [];
      const { asset, fontAsset, text } = layerInputs(
        layer,
        assets,
        project,
        activeLang,
        previewCtx,
      );
      const box = titleLayerBox(layer, asset, fontAsset, text, scale);
      return [
        {
          index,
          x: box.pickX,
          y: box.y,
          width: box.pickWidth,
          height: box.height,
          pickable: !coversWindow(layer.kind, box, window),
        },
      ];
    });
  }, [project, menu, activeLang, assets, hiddenLayerKeys, snapshots, previewArgs, menuId, scale]);
}

interface TitleRenderProps {
  projectId: ProjectId;
  menuId: MenuId;
  /** Pixel scale (e.g. 2 for the title canvas, smaller for thumbnails). */
  scale: number;
  /**
   * The Project to read the menu from, instead of the open one of that id: a version that is
   * not open (a draft shown in Play).
   */
  project?: Project;
  /**
   * Which part to draw. `all` (default): every layer, the selected one draggable. On the
   * board the menu draws it twice around its slots: `visual` under them (every layer but the
   * selected one, none listening), then `interactive` over them (the selected layer, draggable
   * whatever lies under it, and a hit box per pickable layer), so a click picks the topmost
   * thing under the pointer.
   */
  pass?: "all" | "visual" | "interactive";
  /** Ctrl/Cmd+click on a layer of the `interactive` pass: the menu cycles what lies under the pointer. */
  onDeepSelect?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}

/**
 * Stage-less Konva subtree that renders a menu's title layers — title-bar
 * backdrop + every layer in array order (first = bottom). Designed to live
 * inside an existing `<Stage><Layer>`; the caller owns Stage sizing.
 *
 * Always interactive: clicks on layers select them via
 * `uiStore.selectedLayerKey`, drags update positions via `useTitleLayerDrag`.
 * Image layers are not resizable (assets are pixel-perfect). Clicks on the
 * title-bar grey backdrop (non-layer area) clear the selection.
 *
 * Layer body rendering matches the plugin runtime:
 *  - background → big glyph anchored below the title bar (matches negative
 *    ascent push in TitleCompiler)
 *  - glyph → image at intrinsic asset size, scaled
 *  - text → McFontText (bitmap font)
 *  - external_glyph → dashed amber placeholder
 */
export function TitleRender({
  projectId,
  menuId,
  scale,
  project: given,
  pass = "all",
  onDeepSelect,
}: TitleRenderProps) {
  const open = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const project = given ?? open;
  const menu = menusOf(project).find((m) => m.id === menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  const assets = useAssetStore((s) => s.assets);
  const buttonDrag = useImageButtonDragStore((s) =>
    pass !== "visual" && s.drag?.menuId === menuId ? s.drag : null,
  );
  const selectedLayerKey = useUiStore((s) => s.selectedLayerKey);
  const setSelectedLayerKey = useUiStore((s) => s.setSelectedLayerKey);
  const setSelectedMenuId = useUiStore((s) => s.setSelectedMenuId);
  const hiddenLayerKeys = useUiStore((s) => s.hiddenLayerKeys);
  // Preview scope so `{category_name}`-style placeholders in title layers
  // render with the menu's preview context (same scope as the item grid).
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const menuPreviewArgs = useUiStore((s) => s.menuPreviewArgs);
  const previewCtx = useMemo(
    () =>
      project && menu ? buildPreviewScope(menu, project, snapshots, menuPreviewArgs[menuId]) : {},
    [project, menu, snapshots, menuPreviewArgs, menuId],
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

  if (!project || !menu) return null;
  // Labels sit over the buttons they name: on the board the `interactive` pass draws them, above the slots and the image buttons.
  const labels = pass === "visual" ? [] : elementLabels(menu);
  const window = { width: MC_W * scale, height: (MC_TITLE_H + menu.rows * 18) * scale };

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
      {pass !== "interactive" && (
        <Rect
          x={0}
          y={0}
          width={TITLE_BAR_W * scale}
          height={MC_TITLE_H * scale}
          fill="rgba(0,0,0,0.001)"
          onClick={onBackdropClick}
          onTap={onBackdropClick}
        />
      )}
      {menu.title.map((layer, idx) => {
        const hidden = hiddenLayerKeys.has(`${menuId}:${idx}`);
        if (hidden) return null;
        const { asset, fontAsset, text } = layerInputs(
          layer,
          assets,
          project,
          activeLang,
          previewCtx,
        );
        const selected = selectedLayerKey?.menuId === menuId && selectedLayerKey?.index === idx;
        if (pass === "visual" && selected) return null;
        if (pass === "interactive" && !selected) {
          const box = titleLayerBox(layer, asset, fontAsset, text, scale);
          if (coversWindow(layer.kind, box, window)) return null;
          return (
            <Rect
              // biome-ignore lint/suspicious/noArrayIndexKey: layer order is the stable identifier
              key={idx}
              name={`title-layer-hit:${menuId}:${idx}`}
              x={box.pickX}
              y={box.y}
              width={box.pickWidth}
              height={box.height}
              fill="rgba(0,0,0,0.001)"
              onClick={(e) => {
                e.cancelBubble = true;
                if (onDeepSelect && (e.evt.ctrlKey || e.evt.metaKey)) onDeepSelect(e);
                else applyPick(menuId, { kind: "layer", index: idx });
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                applyPick(menuId, { kind: "layer", index: idx });
              }}
            />
          );
        }

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
            selected={pass !== "visual" && selected}
            onDeepSelect={onDeepSelect}
          />
        );
      })}
      {/* Element labels: drawn in the title like the plugin does, edited from the element. */}
      {labels.length > 0 && (
        <Group listening={false}>
          {labels.map(({ elementId, layer }, idx) => {
            // The label of the image button being dragged follows it.
            const moved = buttonDrag?.menuId === menuId && buttonDrag.elementId === elementId;
            return (
              <Group
                key={elementId}
                name={`element-label:${menuId}:${elementId}`}
                x={moved ? buttonDrag.dx : 0}
                y={moved ? buttonDrag.dy : 0}
              >
                <LayerNode
                  projectId={projectId}
                  menuId={menuId}
                  layer={layer}
                  index={-1 - idx}
                  scale={scale}
                  text={renderPreview(
                    getText(project, layer.value, activeLang),
                    previewCtx,
                    project,
                    activeLang,
                  )}
                  selected={false}
                />
              </Group>
            );
          })}
        </Group>
      )}
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
  onDeepSelect?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
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
  onDeepSelect,
}: LayerNodeProps) {
  const [image] = useAuthenticatedImage(asset ? assetPreviewUrl(asset) : "");
  const { onPositionChange } = useTitleLayerDrag({ menuId, layerIndex: index });
  const textFrame = layer.kind === "text" || layer.kind === "textarea" ? asTextFrame(layer) : null;
  const {
    x: groupX,
    y: groupY,
    width: outlineW,
    height: outlineH,
    anchorOffset,
    fontRefAscent,
    imageW,
    imageH,
    textareaTotalH,
    layerSizeScale,
  } = titleLayerBox(layer, asset, fontAsset, text, scale);

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      // The selected layer keeps the hand (Figma): a click leaves it selected,
      // Ctrl/Cmd+click goes to what lies under it.
      const evt = e.evt as MouseEvent;
      if (selected && onDeepSelect && (evt.ctrlKey || evt.metaKey))
        onDeepSelect(e as Konva.KonvaEventObject<MouseEvent>);
    },
    [selected, onDeepSelect],
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
      // Custom-font text is pinned by its font's ascent; every other layer
      // keeps the dragged Y (glyphs within their `glyph_y` floor).
      const finalY =
        layer.kind === "text" && fontRefAscent != null
          ? GLYPH_Y_BASE - fontRefAscent
          : layer.kind === "glyph"
            ? glyphY(snapped.y, asset)
            : snapped.y;
      // Snap the node back so Konva's internal position matches the
      // committed domain coords (no sub-pixel drift on subsequent drags).
      e.target.position({ x: snapped.x * scale, y: finalY * scale });
      onPositionChange({ x: snapped.x + anchorOffset, y: finalY });
    },
    [layer.kind, asset, fontRefAscent, scale, onPositionChange, anchorOffset],
  );

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
    body = lines.map((line, i) => {
      const lineWidth = Math.floor((measureLineWidthJs(line) * (layer.size ?? 8)) / 8);
      const lineX =
        layer.alignment === "center"
          ? (anchorOffset - Math.floor(lineWidth / 2)) * scale
          : layer.alignment === "right"
            ? (anchorOffset - lineWidth) * scale
            : 0;
      const lineY = i * layer.lineHeight * scale;
      return fontAsset ? (
        <McFontText
          // biome-ignore lint/suspicious/noArrayIndexKey: stateless rendered lines follow their visual row.
          key={i}
          text={line}
          font={fontAsset}
          x={lineX}
          y={lineY + (fontRefAscent != null ? fontRefAscent * scale : BASELINE_Y_PX * scale)}
          scale={scale}
          listening={false}
        />
      ) : (
        <VanillaMcText
          // biome-ignore lint/suspicious/noArrayIndexKey: stateless rendered lines follow their visual row.
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
    });
  } else if (layer.kind === "external_glyph") {
    // external_glyph — runtime resolves these; in the editor we show a
    // dashed placeholder labelled with `provider:glyphName`.
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

  // All layer kinds need an explicit hit area: KonvaImage has listening={false}
  // (so glyph/background Groups have no listening child), text hit-tests on
  // rendered glyphs only (gaps break drag pickup), and external_glyph uses
  // listening={false} on every child.
  //
  // We render an almost-transparent Rect sized to the layer's bounding box
  // BEFORE the visible body so Konva picks it up on mousedown anywhere
  // inside the outline (drag works, click selects). The same trick is used
  // for the title-bar backdrop above.
  const hitW = outlineW;
  const hitH =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageH
      : layer.kind === "text" || layer.kind === "plain"
        ? MC_FONT_HEIGHT_PX * scale * layerSizeScale
        : layer.kind === "textarea"
          ? textareaTotalH * scale
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
      <Rect x={0} y={0} width={hitW} height={hitH} fill="rgba(0,0,0,0.001)" listening={selected} />
      {body}
      {selected ? (
        <>
          {/* Yellow 1-px stroke around the bounding box. */}
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
          {textFrame ? (
            <WidthResizeHandle
              x={textFrame.width * scale}
              y={0}
              height={outlineH}
              currentWidth={textFrame.width}
              scale={scale}
              onResize={(newWidth) => {
                useProjectsStore.getState().updateMenuTitleLayer({
                  projectId: _packId,
                  menuId,
                  index,
                  patch: patchTextFrame(textFrame, { width: newWidth }),
                });
              }}
            />
          ) : null}
        </>
      ) : null}
    </Group>
  );
}
