import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Asset, assetPreviewUrl } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { patchAsset } from "@/lib/api/userAssets";
import { cx } from "@/lib/cx";
import {
  COMPOSE_MAX_LAYERS,
  COMPOSE_MAX_REPEAT,
  COMPOSE_MAX_SIDE,
  type ComposeLayer,
  type ComposeRecipe,
  composeSize,
} from "@/lib/pack/compose";
import { KIT_PREFIX, kitNameOf } from "@/lib/pack/kit";
import { slicesAt } from "@/lib/pack/slice";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ImageGuides } from "./ImageGuides";
import { ImageChoiceDialog, KitPicker } from "./KitPicker";
import { LayersPanel } from "./LayersPanel";
import { PixelEditor } from "./PixelEditor";
import { SITUATION_SCALE, SituationPreview } from "./SituationPreview";
import {
  type DrawTool,
  SaveActions,
  type StudioParts,
  StudioSection,
  type StudioTool,
  StudioTools,
  ZoomControls,
  toolOfKey,
  useStageZoom,
} from "./StudioFrame";
import { useAssetStore } from "./assetStore";
import type { GuideName } from "./guideRules";
import { addDrawnLayer, layerOf, layerRef } from "./imageLayers";
import { useKitAssets } from "./kitAssets";
import { type ImageSize, assetSize, useAssetSize, useMeasuredAssetSizes } from "./measuredSize";
import { useSlicedUrl } from "./slicedUrl";

/** One slot of a menu, in pixels: what Shift moves a layer by. */
const SLOT = 18;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Where the image itself starts: what a layer is placed from when nothing else is drawn. */
const ORIGIN: ComposeLayer = { image: "", x: 0, y: 0, columns: 1, rows: 1 };

const NO_GUIDES: readonly GuideName[] = [];

const sameRecipe = (a: ComposeRecipe, b: ComposeRecipe) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a layer may be given a size: its image is sliced (`slice.ts`), and it does not repeat. */
const resizable = (asset: Asset | undefined, layer: ComposeLayer) =>
  !!asset?.slice && layer.columns === 1 && layer.rows === 1;

/**
 * The rectangle a layer covers, in the image's pixels: the size it asks for when its image is
 * sliced and holds it (`layerPicture`), else its image's own, repeated.
 */
function layerBox(asset: Asset, layer: ComposeLayer, size: ImageSize) {
  const { width, height } = layer;
  const resized =
    resizable(asset, layer) &&
    width !== undefined &&
    height !== undefined &&
    slicesAt(asset.slice!, size, width, height);
  return resized
    ? { width, height, resized }
    : { width: layer.columns * size.width, height: layer.rows * size.height, resized };
}

/** One layer on the stage: its image, repeated when it is a grid, dragged by the pointer. */
function StageLayer({
  asset,
  layer,
  scale,
  selected,
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  onResize,
  resizeLabel,
}: {
  asset: Asset;
  layer: ComposeLayer;
  scale: number;
  selected: boolean;
  label: string;
  /** Asks for another size, in the image's pixels: only for a layer that can take one. */
  onResize?: (width: number, height: number) => void;
  resizeLabel?: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const source = assetPreviewUrl(asset);
  const url = useAuthenticatedImageUrl(source);
  // Measured from the image when the descriptor gives no size: the stage waits for it.
  const size = useAssetSize(asset, url);
  const box = size ? layerBox(asset, layer, size) : null;
  const drawn = useSlicedUrl(url, box?.resized ? asset.slice : undefined, box?.width, box?.height);
  const grip = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  if (!size || !box) return null;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        data-testid="compose-layer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cx(
          "absolute cursor-move touch-none border-0 bg-transparent p-0 outline-offset-0",
          selected ? "outline outline-2 outline-[var(--brand)]" : "outline-none",
        )}
        style={{
          left: layer.x * scale,
          top: layer.y * scale,
          width: box.width * scale,
          height: box.height * scale,
          backgroundImage: url ? `url("${drawn ?? url}")` : undefined,
          backgroundSize: box.resized
            ? "100% 100%"
            : `${size.width * scale}px ${size.height * scale}px`,
          backgroundRepeat: box.resized ? "no-repeat" : "repeat",
          imageRendering: "pixelated",
        }}
      />
      {selected && onResize ? (
        <span
          role="slider"
          tabIndex={-1}
          aria-label={resizeLabel}
          aria-valuenow={box.width}
          aria-valuemin={1}
          aria-valuemax={COMPOSE_MAX_SIDE}
          data-testid="compose-resize"
          className="absolute z-10 size-3 cursor-nwse-resize touch-none rounded-[2px] border border-[var(--surface)] bg-[var(--brand)]"
          style={{
            left: (layer.x + box.width) * scale - 6,
            top: (layer.y + box.height) * scale - 6,
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            grip.current = { x: event.clientX, y: event.clientY, ...box };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const held = grip.current;
            if (!held) return;
            // Whole pixels of the game; Shift keeps the size to whole slots.
            const side = (from: number, delta: number) => {
              const to = from + Math.round(delta / scale);
              return event.shiftKey ? Math.max(SLOT, Math.round(to / SLOT) * SLOT) : to;
            };
            onResize(
              side(held.width, event.clientX - held.x),
              side(held.height, event.clientY - held.y),
            );
          }}
          onPointerUp={(event) => {
            grip.current = null;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }}
          onPointerCancel={() => {
            grip.current = null;
          }}
        />
      ) : null}
    </>
  );
}

/**
 * A layer shown without being held: around the one being drawn (`PixelEditor`'s `around`), or
 * in the preview. Placed from the corner `from` gives, at `zoom`, out of the pointer's way.
 * `picture` shows the layer as it is drawn now, in place of its saved file.
 */
function AroundLayer({
  asset,
  layer,
  from,
  zoom,
  faint,
  picture,
}: {
  asset: Asset;
  layer: ComposeLayer;
  from: ComposeLayer;
  zoom: number;
  faint: boolean;
  picture?: string;
}) {
  const fetched = useAuthenticatedImageUrl(assetPreviewUrl(asset));
  const size = useAssetSize(asset, fetched);
  const url = picture || fetched;
  const box = size ? layerBox(asset, layer, size) : null;
  const drawn = useSlicedUrl(url, box?.resized ? asset.slice : undefined, box?.width, box?.height);
  if (!size || !box) return null;
  return (
    <span
      aria-hidden
      data-testid="compose-around"
      className={cx("pointer-events-none absolute", faint && "opacity-50")}
      style={{
        left: (layer.x - from.x) * zoom,
        top: (layer.y - from.y) * zoom,
        width: box.width * zoom,
        height: box.height * zoom,
        backgroundImage: url ? `url("${drawn ?? url}")` : undefined,
        backgroundSize: box.resized
          ? "100% 100%"
          : `${size.width * zoom}px ${size.height * zoom}px`,
        backgroundRepeat: box.resized ? "no-repeat" : "repeat",
        imageRendering: "pixelated",
      }}
    />
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="field-label">{label}</span>
      <Input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(next)) onChange(clamp(next, min, max));
        }}
        className="h-7 w-16 font-mono text-xs"
      />
    </div>
  );
}

/**
 * An image of several layers in the atelier (`lib/pack/compose.ts`): its layers on a stage at a
 * whole number of times the game's pixels, and listed from the top one down. With the move
 * tool a layer is dragged (Shift: by one slot), nudged with the arrow keys, repeated as a
 * grid, reordered and removed; a new one is a common image, a PNG of the module, or one drawn
 * here, an empty PNG of the image's size added on top. With a drawing tool, the selected layer
 * is drawn pixel by pixel among the others (`PixelEditor`), when it is a PNG of the module: a
 * common image is redrawn among the common images. What is saved is the recipe itself, so what
 * an AI app composed is edited here, and the other way round. It renders nothing by itself:
 * `layout` places its parts.
 */
export function ComposedImageEditor({
  projectId,
  asset,
  tool,
  onTool,
  guides = NO_GUIDES,
  situation = false,
  footer,
  layout,
}: {
  projectId: ProjectId;
  asset: Asset;
  /** The tool in hand. */
  tool: StudioTool;
  onTool: (tool: StudioTool) => void;
  /** The guides drawn over the stage (`ImageGuides`). */
  guides?: readonly GuideName[];
  /** Shows the image where a player sees it (`SituationPreview`). */
  situation?: boolean;
  /** Under the list of layers: what is done to them as a whole. */
  footer?: ReactNode;
  layout: (parts: StudioParts) => ReactNode;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const user = useProjectPrincipalId(projectId);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const all = useAssetStore((s) => s.assets);
  const kit = useKitAssets();
  const measured = useMeasuredAssetSizes();

  const saved = asset.compose as ComposeRecipe;
  const [recipe, setRecipe] = useState(saved);
  const [selected, setSelected] = useState<number | null>(null);
  const [picker, setPicker] = useState<"kit" | "module" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Another recipe under this asset (saved, or changed by someone else): start again from it.
  useEffect(() => {
    setRecipe(saved);
    setSelected((held) => (held !== null && held < saved.layers.length ? held : null));
    setError(null);
  }, [saved]);

  /** What a layer may be: a PNG of this module (never a composed image, nor this one). */
  const own = useMemo(
    () => all.filter((a) => a.projectId === projectId && a.type !== "font" && !a.compose),
    [all, projectId],
  );
  // A common image is written `artisan:<name>`; `kit:<name>` is the former spelling, still read.
  const imageOf = (name: string): Asset | undefined => {
    const common = kitNameOf(name);
    return common !== null
      ? kit.find((a) => a.id === KIT_PREFIX + common)
      : own.find((a) => a.name === name);
  };
  const sizeOf = (name: string): ImageSize | undefined => assetSize(imageOf(name), measured);
  /** The PNG of the module the layer at `index` shows: what can be drawn on here. */
  const drawingAt = (index: number | null): Asset | undefined => {
    const layer = index === null ? undefined : recipe.layers[index];
    return layer && kitNameOf(layer.image) === null ? imageOf(layer.image) : undefined;
  };
  let topDrawing = -1;
  recipe.layers.forEach((_, index) => {
    if (drawingAt(index)) topDrawing = index;
  });
  // Nothing to draw on: the drawing tools are out of reach, whatever was in hand.
  const held: StudioTool = tool !== "move" && topDrawing < 0 ? "move" : tool;
  // A drawing tool acts on a drawing: the top one when none is selected.
  useEffect(() => {
    if (held !== "move" && selected === null && topDrawing >= 0) setSelected(topDrawing);
  }, [held, selected, topDrawing]);

  const size = composeSize(recipe, sizeOf);
  const view = useStageZoom(size ?? null, { fallback: 2 });
  const scale = view.zoom;

  const update = (index: number, patch: Partial<ComposeLayer>) =>
    setRecipe((r) => ({
      ...r,
      layers: r.layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)),
    }));
  /** Gives the layer at `index` a size its sliced image holds, kept inside what an image may be. */
  const resize = (index: number, width: number, height: number) => {
    const layer = recipe.layers[index];
    const image = layer && imageOf(layer.image);
    const slice = image?.slice;
    if (!layer || !slice) return;
    update(index, {
      width: clamp(Math.round(width), Math.max(1, slice.left + slice.right), COMPOSE_MAX_SIDE),
      height: clamp(Math.round(height), Math.max(1, slice.top + slice.bottom), COMPOSE_MAX_SIDE),
    });
  };
  const place = (index: number, x: number, y: number) =>
    update(index, {
      x: clamp(Math.round(x), -COMPOSE_MAX_SIDE, COMPOSE_MAX_SIDE),
      y: clamp(Math.round(y), -COMPOSE_MAX_SIDE, COMPOSE_MAX_SIDE),
    });
  /** The layer the tools act on. One that cannot be drawn on is moved: the move tool takes over. */
  const select = (index: number) => {
    setSelected(index);
    if (held !== "move" && !drawingAt(index)) onTool("move");
  };
  const pickTool = (next: StudioTool) => {
    if (next !== "move" && !drawingAt(selected) && topDrawing >= 0) setSelected(topDrawing);
    onTool(next);
  };
  const move = (index: number, to: number) => {
    if (to < 0 || to >= recipe.layers.length) return;
    setRecipe((r) => {
      const layers = r.layers.slice();
      const [layer] = layers.splice(index, 1);
      layers.splice(to, 0, layer as ComposeLayer);
      return { ...r, layers };
    });
    setSelected(to);
  };
  const remove = (index: number) => {
    setRecipe((r) => ({ ...r, layers: r.layers.filter((_, i) => i !== index) }));
    setSelected(null);
    if (held !== "move") onTool("move");
  };
  const add = (picked: Asset) => {
    setPicker(null);
    if (recipe.layers.length >= COMPOSE_MAX_LAYERS) return;
    setRecipe((r) => ({ ...r, layers: [...r.layers, layerOf(layerRef(picked))] }));
    // A layer just set down is placed first.
    setSelected(recipe.layers.length);
    if (held !== "move") onTool("move");
  };

  const drag = useRef<{ index: number; x: number; y: number; left: number; top: number } | null>(
    null,
  );
  const handlers = (index: number, layer: ComposeLayer) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      setSelected(index);
      drag.current = { index, x: event.clientX, y: event.clientY, left: layer.x, top: layer.y };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const dragged = drag.current;
      if (!dragged || dragged.index !== index) return;
      // Whole pixels of the game; Shift keeps to whole slots from where the layer was.
      const step = event.shiftKey ? SLOT : 1;
      const by = (delta: number) => Math.round(delta / scale / step) * step;
      place(
        index,
        dragged.left + by(event.clientX - dragged.x),
        dragged.top + by(event.clientY - dragged.y),
      );
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      drag.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? SLOT : 1;
      const by: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = by[event.key];
      if (!delta) return;
      event.preventDefault();
      place(index, layer.x + delta[0], layer.y + delta[1]);
    },
  });

  const dirty = !sameRecipe(recipe, saved);
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!user || busy || recipe.layers.length === 0) return false;
    setBusy(true);
    setError(null);
    try {
      upsertAsset(await patchAsset(projectId, asset.id, { compose: recipe }));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** A layer to draw, on top of the others (`addDrawnLayer`): it is selected, a pencil in hand. */
  const draw = async () => {
    if (!user || busy || recipe.layers.length >= COMPOSE_MAX_LAYERS) return;
    setBusy(true);
    setError(null);
    try {
      const taken = new Set(all.filter((a) => a.projectId === projectId).map((a) => a.name));
      const made = await addDrawnLayer(projectId, asset, recipe, taken, {
        width: size?.width ?? SLOT,
        height: size?.height ?? SLOT,
      });
      upsertAsset(made.layer);
      const next = made.image.compose as ComposeRecipe;
      setRecipe(next);
      upsertAsset(made.image);
      setSelected(next.layers.length - 1);
      onTool(held === "move" ? "pencil" : held);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const labelOf = (layer: ComposeLayer) => kitNameOf(layer.image) ?? layer.image;
  const current = selected === null ? undefined : recipe.layers[selected];
  const currentImage = current && imageOf(current.image);
  const currentSize = current && sizeOf(current.image);
  // A layer of a sliced image takes a size, in place of a count of repeats.
  const stretches = !!current && resizable(currentImage, current);
  const currentBox =
    current && currentImage && currentSize ? layerBox(currentImage, current, currentSize) : null;
  const fixed = recipe.width !== null && recipe.height !== null;
  const full = recipe.layers.length >= COMPOSE_MAX_LAYERS;

  const target = held !== "move" && drawingAt(selected) ? selected : null;
  const drawn = target === null ? undefined : recipe.layers[target];
  const drawnImage = drawingAt(target);

  /** The layers from `from` to `to`, shown without being held (`AroundLayer`). */
  const shown = (from: number, to: number, zoom: number, faint: boolean, picture?: string) =>
    recipe.layers.slice(from, to).map((layer, i) => {
      const image = imageOf(layer.image);
      return image ? (
        <AroundLayer
          // biome-ignore lint/suspicious/noArrayIndexKey: layers have no identity but their place in the stack
          key={from + i}
          asset={image}
          layer={layer}
          from={ORIGIN}
          zoom={zoom}
          faint={faint}
          picture={from + i === target ? picture : undefined}
        />
      ) : null;
    });

  /**
   * The right column. `before` runs ahead of what leaves the layer being drawn (another layer
   * selected, one added or removed): its pixels are saved first, and it stays when that fails.
   */
  const panels = (
    before: (() => Promise<boolean>) | null,
    picture?: string,
    colour?: ReactNode,
  ) => {
    const then = (work: () => void) => () => {
      if (before) void before().then((ok) => ok && work());
      else work();
    };
    return (
      <>
        <LayersPanel
          rows={recipe.layers.map((layer, index) => ({
            index,
            label: labelOf(layer),
            image: imageOf(layer.image),
            picture: index === target ? picture : undefined,
            repeat:
              layer.columns > 1 || layer.rows > 1 ? `${layer.columns} × ${layer.rows}` : undefined,
            common: kitNameOf(layer.image) !== null,
          }))}
          selected={selected}
          onSelect={(index) => then(() => select(index))()}
          onMove={move}
          onRemove={(index) => then(() => remove(index))()}
          add={{
            common: then(() => setPicker("kit")),
            module: then(() => setPicker("module")),
            drawn: then(() => void draw()),
            disabled: !user || busy || full,
          }}
        >
          {footer}
        </LayersPanel>

        {current && selected !== null && (
          <StudioSection title={t("studio.layer")} testId="compose-layer-fields">
            <div className="flex flex-wrap gap-3">
              <NumberField
                label={t("compose.x")}
                value={current.x}
                min={-COMPOSE_MAX_SIDE}
                max={COMPOSE_MAX_SIDE}
                onChange={(x) => update(selected, { x })}
              />
              <NumberField
                label={t("compose.y")}
                value={current.y}
                min={-COMPOSE_MAX_SIDE}
                max={COMPOSE_MAX_SIDE}
                onChange={(y) => update(selected, { y })}
              />
              {stretches ? (
                <>
                  <NumberField
                    label={t("compose.layerWidth")}
                    value={currentBox?.width ?? 1}
                    min={1}
                    max={COMPOSE_MAX_SIDE}
                    onChange={(width) => resize(selected, width, currentBox?.height ?? 1)}
                  />
                  <NumberField
                    label={t("compose.layerHeight")}
                    value={currentBox?.height ?? 1}
                    min={1}
                    max={COMPOSE_MAX_SIDE}
                    onChange={(height) => resize(selected, currentBox?.width ?? 1, height)}
                  />
                </>
              ) : (
                <>
                  <NumberField
                    label={t("compose.columns")}
                    value={current.columns}
                    min={1}
                    max={COMPOSE_MAX_REPEAT}
                    onChange={(columns) => update(selected, { columns })}
                  />
                  <NumberField
                    label={t("compose.rows")}
                    value={current.rows}
                    min={1}
                    max={COMPOSE_MAX_REPEAT}
                    onChange={(rows) => update(selected, { rows })}
                  />
                </>
              )}
            </div>
            {stretches ? (
              <p className="text-[11px] text-[var(--text-faint)]">{t("compose.resizeHint")}</p>
            ) : null}
            {held === "move" && drawingAt(selected) ? (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={!user}
                onClick={() => pickTool("pencil")}
              >
                {t("compose.retouchLayer")}
              </Button>
            ) : null}
            {kitNameOf(current.image) !== null ? (
              <p className="text-[11px] text-[var(--text-faint)]">{t("studio.commonHint")}</p>
            ) : null}
          </StudioSection>
        )}

        {colour ? <StudioSection title={t("pixel.colour")}>{colour}</StudioSection> : null}

        <StudioSection title={t("studio.size")}>
          <label className="flex items-center gap-2 text-xs" htmlFor={`${fieldId}-fixed`}>
            <input
              id={`${fieldId}-fixed`}
              type="checkbox"
              className="accent-[var(--brand)]"
              checked={fixed}
              onChange={(event) =>
                setRecipe((r) => ({
                  ...r,
                  width: event.target.checked ? (size?.width ?? SLOT) : null,
                  height: event.target.checked ? (size?.height ?? SLOT) : null,
                }))
              }
            />
            {t("compose.fixedSize")}
          </label>
          {fixed && (
            <div className="flex gap-3">
              <NumberField
                label={t("compose.width")}
                value={recipe.width ?? 1}
                min={1}
                max={COMPOSE_MAX_SIDE}
                onChange={(width) => setRecipe((r) => ({ ...r, width }))}
              />
              <NumberField
                label={t("compose.height")}
                value={recipe.height ?? 1}
                min={1}
                max={COMPOSE_MAX_SIDE}
                onChange={(height) => setRecipe((r) => ({ ...r, height }))}
              />
            </div>
          )}
          <p className="text-[11px] text-[var(--text-faint)]">{t("compose.sizeHint")}</p>
        </StudioSection>
      </>
    );
  };

  const preview = (picture?: string) =>
    situation && size ? (
      <StudioSection title={t("studio.guides.situation")}>
        <SituationPreview width={size.width} height={size.height}>
          {shown(0, recipe.layers.length, SITUATION_SCALE, false, picture)}
        </SituationPreview>
      </StudioSection>
    ) : null;

  const pickers = (
    <>
      <KitPicker open={picker === "kit"} onClose={() => setPicker(null)} onPick={add} />
      <ImageChoiceDialog
        open={picker === "module"}
        onClose={() => setPicker(null)}
        onPick={add}
        title={t("compose.chooseImage")}
        hint={t("compose.chooseImageHint")}
        empty={t("compose.noImage")}
        assets={own}
      />
    </>
  );

  if (drawn && drawnImage && target !== null) {
    // The whole image is shown, the layers under and over the one drawn on, which alone takes
    // the pencil. The layers above are shown through, so what is drawn under them stays visible.
    const around = (zoom: number, picture: string) => ({
      under: (
        <>
          {shown(0, target, zoom, false)}
          {(drawn.columns > 1 || drawn.rows > 1) && shown(target, target + 1, zoom, false, picture)}
        </>
      ),
      over: (
        <>
          {shown(target + 1, recipe.layers.length, zoom, true)}
          {size && (
            <ImageGuides
              width={size.width}
              height={size.height}
              scale={zoom}
              shown={guides}
              slice={asset.slice}
            />
          )}
        </>
      ),
    });
    return (
      <>
        <PixelEditor
          key={drawnImage.id}
          projectId={projectId}
          asset={drawnImage}
          tool={held as DrawTool}
          onTool={onTool}
          within={
            size ? { width: size.width, height: size.height, x: drawn.x, y: drawn.y } : undefined
          }
          around={around}
          layout={(pixels) =>
            layout({
              rail: pixels.rail,
              stage: pixels.stage,
              status: pixels.status,
              controls: pixels.controls,
              keys: pixels.keys,
              actions: (
                <SaveActions
                  dirty={pixels.dirty || dirty}
                  busy={pixels.busy || busy}
                  canSave={!!user}
                  error={pixels.error ?? error}
                  onSave={() => void pixels.save().then((ok) => ok && save())}
                  onDiscard={() => {
                    pixels.discard();
                    setRecipe(saved);
                  }}
                />
              ),
              panels: panels(pixels.save, pixels.picture, pixels.colour),
              preview: preview(pixels.picture),
            })
          }
        />
        {pickers}
      </>
    );
  }

  return (
    <>
      {layout({
        keys: (event) => {
          if ((event.target as HTMLElement).tagName === "INPUT") return;
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const chosen = toolOfKey(event.key);
          if (chosen && (chosen === "move" || topDrawing >= 0)) pickTool(chosen);
        },
        rail: (
          <StudioTools
            value={held}
            onChange={pickTool}
            draw={topDrawing < 0 ? t("studio.noDrawing") : undefined}
          />
        ),
        controls: <ZoomControls view={view} />,
        stage: (
          <div
            ref={view.ref}
            className="checker flex min-h-0 flex-1 overflow-auto p-4"
            data-testid="compose-editor"
          >
            {size ? (
              <div
                className="relative m-auto shrink-0 overflow-hidden outline outline-1 outline-[var(--border-strong)]"
                data-testid="compose-stage"
                style={{ width: size.width * scale, height: size.height * scale }}
              >
                {recipe.layers.map((layer, index) => {
                  const image = imageOf(layer.image);
                  return image ? (
                    <StageLayer
                      // biome-ignore lint/suspicious/noArrayIndexKey: layers have no identity but their place in the stack
                      key={index}
                      asset={image}
                      layer={layer}
                      scale={scale}
                      selected={selected === index}
                      label={t("compose.layerLabel", { name: labelOf(layer), n: index + 1 })}
                      {...handlers(index, layer)}
                      onResize={
                        held === "move" && resizable(image, layer)
                          ? (width, height) => resize(index, width, height)
                          : undefined
                      }
                      resizeLabel={t("compose.resize", { name: labelOf(layer) })}
                    />
                  ) : null;
                })}
                <ImageGuides
                  width={size.width}
                  height={size.height}
                  scale={scale}
                  shown={guides}
                  slice={asset.slice}
                />
              </div>
            ) : (
              <p className="m-auto text-center text-xs text-[var(--text-mut)]">
                {t("compose.nothing")}
              </p>
            )}
          </div>
        ),
        status: (
          <>
            <span>{t("compose.dragHint")}</span>
            {size && (
              <span className="shrink-0">
                {size.width} × {size.height} px
                {scale >= 1 ? ` · ${t("resources.zoom", { scale })}` : ""}
              </span>
            )}
          </>
        ),
        actions: (
          <SaveActions
            dirty={dirty}
            busy={busy}
            canSave={!!user && recipe.layers.length > 0}
            error={error}
            onSave={() => void save()}
            onDiscard={() => setRecipe(saved)}
          />
        ),
        panels: panels(null),
        preview: preview(),
      })}
      {pickers}
    </>
  );
}
