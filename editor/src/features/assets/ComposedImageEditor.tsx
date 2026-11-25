import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Asset, assetPreviewUrl } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { patchAsset, uploadAsset } from "@/lib/api/userAssets";
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
import { createImage, encodePng } from "@/lib/pack/png";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ImageChoiceDialog, KitPicker } from "./KitPicker";
import { PixelEditor } from "./PixelEditor";
import { useAssetStore } from "./assetStore";
import { useKitAssets } from "./kitAssets";
import { type ImageSize, assetSize, useAssetSize, useMeasuredAssetSizes } from "./measuredSize";

/** One slot of a menu, in pixels: what Shift moves a layer by. */
const SLOT = 18;
/** How much of the window's height the stage may take. */
const STAGE_HEIGHT = 0.6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sameRecipe = (a: ComposeRecipe, b: ComposeRecipe) => JSON.stringify(a) === JSON.stringify(b);

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
}: {
  asset: Asset;
  layer: ComposeLayer;
  scale: number;
  selected: boolean;
  label: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const source = assetPreviewUrl(asset);
  const url = useAuthenticatedImageUrl(source);
  // Measured from the image when the descriptor gives no size: the stage waits for it.
  const size = useAssetSize(asset, url);
  if (!size) return null;
  return (
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
        width: layer.columns * size.width * scale,
        height: layer.rows * size.height * scale,
        backgroundImage: url ? `url("${url}")` : undefined,
        backgroundSize: `${size.width * scale}px ${size.height * scale}px`,
        backgroundRepeat: "repeat",
        imageRendering: "pixelated",
      }}
    />
  );
}

/**
 * A layer shown around the one being drawn (`PixelEditor`'s `around`): placed from that layer's
 * top left corner, at the pixel editor's zoom, and out of the pointer's way.
 */
function AroundLayer({
  asset,
  layer,
  from,
  zoom,
  faint,
}: {
  asset: Asset;
  layer: ComposeLayer;
  from: ComposeLayer;
  zoom: number;
  faint: boolean;
}) {
  const url = useAuthenticatedImageUrl(assetPreviewUrl(asset));
  const size = useAssetSize(asset, url);
  if (!size) return null;
  return (
    <span
      aria-hidden
      data-testid="compose-around"
      className={cx("pointer-events-none absolute", faint && "opacity-50")}
      style={{
        left: (layer.x - from.x) * zoom,
        top: (layer.y - from.y) * zoom,
        width: layer.columns * size.width * zoom,
        height: layer.rows * size.height * zoom,
        backgroundImage: url ? `url("${url}")` : undefined,
        backgroundSize: `${size.width * zoom}px ${size.height * zoom}px`,
        backgroundRepeat: "repeat",
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
 * A composed image edited with the mouse (`lib/pack/compose.ts`): its layers on a stage at a
 * whole number of times the game's pixels, and listed from the top one down. A layer is dragged
 * (Shift: by one slot), nudged with the arrow keys, repeated as a grid, reordered and removed;
 * a new one is a kit image, a PNG of the module, or one drawn here: an empty PNG of the image's
 * size added on top and opened in the pixel editor among the other layers, as any PNG layer of
 * the module is retouched. What is saved is the recipe itself, so what an AI app composed is
 * edited here, and the other way round.
 */
export function ComposedImageEditor({ projectId, asset }: { projectId: ProjectId; asset: Asset }) {
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
  /** The layer being drawn pixel by pixel, in place of the stage. */
  const [drawing, setDrawing] = useState<number | null>(null);
  // Another recipe under this asset (saved, or changed by someone else): start again from it.
  useEffect(() => {
    setRecipe(saved);
    setSelected(null);
    setError(null);
  }, [saved]);

  /** What a layer may be: a PNG of this module (never a composed image, nor this one). */
  const own = useMemo(
    () => all.filter((a) => a.projectId === projectId && a.type !== "font" && !a.compose),
    [all, projectId],
  );
  const imageOf = (name: string): Asset | undefined =>
    kitNameOf(name) !== null ? kit.find((a) => a.id === name) : own.find((a) => a.name === name);
  const sizeOf = (name: string): ImageSize | undefined => assetSize(imageOf(name), measured);

  const size = composeSize(recipe, sizeOf);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // As large as the panel is wide, a whole number of times the game's pixels, and no taller
  // than most of the window; smaller than the game's only when the image is wider than the panel.
  const fit =
    size && width > 0
      ? Math.min(width / size.width, (window.innerHeight * STAGE_HEIGHT) / size.height)
      : 2;
  const scale = fit >= 1 ? Math.floor(fit) : fit;

  const update = (index: number, patch: Partial<ComposeLayer>) =>
    setRecipe((r) => ({
      ...r,
      layers: r.layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)),
    }));
  const place = (index: number, x: number, y: number) =>
    update(index, {
      x: clamp(Math.round(x), -COMPOSE_MAX_SIDE, COMPOSE_MAX_SIDE),
      y: clamp(Math.round(y), -COMPOSE_MAX_SIDE, COMPOSE_MAX_SIDE),
    });
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
  };
  const add = (picked: Asset) => {
    setPicker(null);
    if (recipe.layers.length >= COMPOSE_MAX_LAYERS) return;
    setRecipe((r) => ({
      ...r,
      layers: [...r.layers, { image: picked.name, x: 0, y: 0, columns: 1, rows: 1 }],
    }));
    setSelected(recipe.layers.length);
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
      const held = drag.current;
      if (!held || held.index !== index) return;
      // Whole pixels of the game; Shift keeps to whole slots from where the layer was.
      const step = event.shiftKey ? SLOT : 1;
      const by = (delta: number) => Math.round(delta / scale / step) * step;
      place(index, held.left + by(event.clientX - held.x), held.top + by(event.clientY - held.y));
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
  const save = async () => {
    if (!user || busy || recipe.layers.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      upsertAsset(await patchAsset(projectId, asset.id, { compose: recipe }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /**
   * A layer to draw: an empty PNG of the image's size, a file of the module, on top of the
   * others. The recipe is saved with it, so the file never stays without the layer that shows it.
   */
  const draw = async () => {
    if (!user || busy || recipe.layers.length >= COMPOSE_MAX_LAYERS) return;
    setBusy(true);
    setError(null);
    try {
      const taken = new Set(all.filter((a) => a.projectId === projectId).map((a) => a.name));
      let name = `${asset.name}_layer`;
      for (let n = 2; taken.has(name); n++) name = `${asset.name}_layer_${n}`;
      const png = encodePng(createImage(size?.width ?? SLOT, size?.height ?? SLOT));
      const made = await uploadAsset(projectId, {
        file: new File([png as Uint8Array<ArrayBuffer>], `${name}.png`, { type: "image/png" }),
        type: "glyph",
        name,
        usages: [],
      });
      upsertAsset(made);
      const next = {
        ...recipe,
        layers: [...recipe.layers, { image: made.name, x: 0, y: 0, columns: 1, rows: 1 }],
      };
      setRecipe(next);
      upsertAsset(await patchAsset(projectId, asset.id, { compose: next }));
      setDrawing(next.layers.length - 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const labelOf = (layer: ComposeLayer) =>
    kitNameOf(layer.image) !== null ? layer.image.slice(KIT_PREFIX.length) : layer.image;
  const current = selected === null ? undefined : recipe.layers[selected];
  const fixed = recipe.width !== null && recipe.height !== null;

  const drawn = drawing === null ? undefined : recipe.layers[drawing];
  const drawnImage = drawn && kitNameOf(drawn.image) === null ? imageOf(drawn.image) : undefined;
  if (drawn && drawnImage && drawing !== null) {
    const around = (zoom: number) => {
      const shown = (from: number, to: number, faint: boolean) =>
        recipe.layers.slice(from, to).map((layer, i) => {
          const image = imageOf(layer.image);
          return image ? (
            <AroundLayer
              // biome-ignore lint/suspicious/noArrayIndexKey: layers have no identity but their place in the stack
              key={from + i}
              asset={image}
              layer={layer}
              from={drawn}
              zoom={zoom}
              faint={faint}
            />
          ) : null;
        });
      // The layers above are shown through, so what is drawn under them stays visible.
      return {
        under: shown(0, drawing, false),
        over: shown(drawing + 1, recipe.layers.length, true),
      };
    };
    return (
      <div className="flex flex-col gap-2" data-testid="compose-drawing">
        <p className="text-xs text-[var(--text-mut)]">
          {t("compose.drawing", { name: drawn.image })}
        </p>
        <PixelEditor
          projectId={projectId}
          asset={drawnImage}
          onClose={() => setDrawing(null)}
          around={around}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="compose-editor">
      <figure className="flex flex-col gap-1">
        <div
          ref={frame}
          className="checker flex min-h-32 w-full items-center justify-center overflow-hidden rounded-[var(--r-md)] border border-[var(--border-soft)] p-3"
        >
          {size ? (
            <div
              className="relative shrink-0 overflow-hidden outline outline-1 outline-[var(--border-strong)]"
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
                  />
                ) : null;
              })}
            </div>
          ) : (
            <p className="text-center text-xs text-[var(--text-mut)]">{t("compose.nothing")}</p>
          )}
        </div>
        <figcaption className="flex justify-between gap-2 text-[11px] text-[var(--text-faint)]">
          <span>{t("compose.dragHint")}</span>
          {size && (
            <span className="shrink-0">
              {size.width} × {size.height} px
              {scale >= 1 ? ` · ${t("resources.zoom", { scale })}` : ""}
            </span>
          )}
        </figcaption>
      </figure>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="field-label">{t("compose.layers")}</span>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setPicker("kit")}>
              {t("compose.addKit")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPicker("module")}>
              {t("compose.addImage")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!user || busy || recipe.layers.length >= COMPOSE_MAX_LAYERS}
              onClick={() => void draw()}
            >
              {t("compose.addDrawn")}
            </Button>
          </div>
        </div>
        {/* The top layer first, as it is seen. */}
        <ul className="flex flex-col gap-1">
          {recipe.layers
            .map((layer, index) => ({ layer, index }))
            .reverse()
            .map(({ layer, index }) => {
              const image = imageOf(layer.image);
              return (
                <li
                  key={index}
                  className={cx(
                    "flex items-center gap-1 rounded-[8px] border px-1.5 py-1",
                    selected === index
                      ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                      : "border-[var(--border-soft)] bg-[var(--surface-raised)]",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-xs text-[var(--text)]"
                    aria-pressed={selected === index}
                    onClick={() => setSelected(selected === index ? null : index)}
                  >
                    <span className="truncate font-mono">{labelOf(layer)}</span>
                    {(layer.columns > 1 || layer.rows > 1) && (
                      <span className="badge shrink-0">
                        {layer.columns} × {layer.rows}
                      </span>
                    )}
                    {!image && (
                      <span className="badge badge-amber shrink-0">{t("compose.missing")}</span>
                    )}
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t("compose.up", { name: labelOf(layer) })}
                    disabled={index === recipe.layers.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t("compose.down", { name: labelOf(layer) })}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t("compose.remove", { name: labelOf(layer) })}
                    disabled={recipe.layers.length === 1}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              );
            })}
        </ul>
      </div>

      {current && selected !== null && (
        <div className="flex flex-wrap gap-3" data-testid="compose-layer-fields">
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
          {kitNameOf(current.image) === null && imageOf(current.image) ? (
            <Button
              size="sm"
              variant="outline"
              className="self-end"
              disabled={!user}
              onClick={() => setDrawing(selected)}
            >
              {t("compose.retouchLayer")}
            </Button>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
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
      </div>

      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRecipe(saved)}>
            {t("compose.reset")}
          </Button>
          <Button variant="primary" size="sm" disabled={busy || !user} onClick={() => void save()}>
            {t(busy ? "compose.saving" : "compose.save")}
          </Button>
        </div>
      )}

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
    </div>
  );
}
