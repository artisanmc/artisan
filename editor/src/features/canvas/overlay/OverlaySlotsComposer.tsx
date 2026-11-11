import { McScreen, McScreenControls, type McScreenSettings } from "@/components/mc-preview";
import { Button } from "@/components/ui/button";
import { AssetInput } from "@/features/assets/AssetInput";
import { useAssetStore } from "@/features/assets/assetStore";
import { assetSize, useMeasuredAssetSizes } from "@/features/assets/measuredSize";
import { cx } from "@/lib/cx";
import {
  type McScreenGeometry,
  type OverlayLayer,
  type OverlaySlotImage,
  type OverlaySlotsComposerProps,
  readOverlayLayout,
} from "@artisan/editor-sdk";
import { RotateCcw } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberField, Stage, clamp, clampY, previewContent } from "./OverlayComposer";

/** How far a given image may move from its slot, either way. */
const MAX_OFFSET = 128;

type Slot = Extract<OverlayLayer, { kind: "image_slot" }>;
type Fill = { image: string; x: number; y: number };

/** The value's entry for `slot`, read as the file may hold it: an asset, or `{image, x, y}`. */
export function readFill(value: unknown, slot: string): Fill | null {
  const entry =
    value && typeof value === "object" ? (value as Record<string, unknown>)[slot] : undefined;
  if (typeof entry === "string") return entry.trim() ? { image: entry.trim(), x: 0, y: 0 } : null;
  if (!entry || typeof entry !== "object") return null;
  const { image, x, y } = entry as Record<string, unknown>;
  if (typeof image !== "string" || !image.trim()) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);
  return { image: image.trim(), x: n(x), y: n(y) };
}

/** A fill as written: no offset left out. */
function writeFill(fill: Fill): OverlaySlotImage {
  return { image: fill.image, ...(fill.x ? { x: fill.x } : {}), ...(fill.y ? { y: fill.y } : {}) };
}

/** The offset a slot's image may take: its top within the pack's reach, as the composer's. */
function clampOffset(slot: Slot, x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, -MAX_OFFSET, MAX_OFFSET),
    y: clamp(clampY(slot, slot.y + y) - slot.y, -MAX_OFFSET, MAX_OFFSET),
  };
}

type SlotDrag = {
  slot: string;
  startX: number;
  startY: number;
  ratio: number;
  origin: Fill;
  current: Fill;
};

/**
 * A mode's HUD with only its image slots open (SDK 1.16): what a speaker gives each slot, picked
 * by its thumbnail and moved from the slot's place by dragging it (arrows: 1 px, Shift: 10 px).
 * The mode's other layers are drawn but fixed. The value maps each slot to its image and offset,
 * `{portrait: {image, x, y}}`; an offset, not a position, so a slot moved in the mode keeps
 * every speaker's adjustment.
 */
export function OverlaySlotsComposer({
  projectId,
  layout,
  value,
  onChange,
  slots,
  preview,
  toolbar,
}: OverlaySlotsComposerProps) {
  const { t } = useTranslation();
  const read = useMemo(() => readOverlayLayout(layout), [layout]);
  const [settings, setSettings] = useState<McScreenSettings>({
    width: 854,
    height: 480,
    guiScale: "auto",
    zoom: "fit",
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<SlotDrag | null>(null);
  const assets = useAssetStore((s) => s.assets);
  const measured = useMeasuredAssetSizes();
  const sizeOf = (name: string) =>
    assetSize(
      assets.find((a) => a.projectId === projectId && a.name === name),
      measured,
    );

  const layers = read.layers;
  const open = layers.filter((l): l is Slot => l.kind === "image_slot");
  const label = (name: string) => slots.find((s) => s.name === name)?.label ?? name;
  const fillOf = (slot: string): Fill | null =>
    drag && drag.slot === slot ? drag.current : readFill(value, slot);

  const content = previewContent(layers, preview);
  content.images = { ...content.images };
  for (const slot of open) {
    const fill = fillOf(slot.name);
    if (fill) content.images[slot.name] = fill;
  }

  const base = (): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  const commit = (slot: string, fill: Fill | null) => {
    const next = base();
    if (fill) next[slot] = writeFill(fill);
    else delete next[slot];
    onChange(next);
  };

  const indexOf = (slot: string) =>
    layers.findIndex((l) => l.kind === "image_slot" && l.name === slot);
  const startDrag = (event: ReactPointerEvent, index: number, geometry: McScreenGeometry) => {
    const layer = layers[index];
    if (layer?.kind !== "image_slot" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(layer.name);
    const fill = readFill(value, layer.name);
    // A slot showing its default, or nothing: the speaker has no image of its own to move.
    if (!fill) return;
    const host = (event.currentTarget as HTMLElement).closest(
      "[data-overlay-stage]",
    ) as HTMLElement | null;
    const zoom =
      host && host.offsetWidth > 0 ? host.getBoundingClientRect().width / host.offsetWidth : 1;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setDrag({
      slot: layer.name,
      startX: event.clientX,
      startY: event.clientY,
      ratio: (zoom || 1) * geometry.scale,
      origin: fill,
      current: fill,
    });
  };
  const onDragMove = (event: ReactPointerEvent) => {
    if (!drag) return;
    const slot = open.find((s) => s.name === drag.slot);
    if (!slot) return;
    const dx = Math.round((event.clientX - drag.startX) / drag.ratio);
    const dy = Math.round((event.clientY - drag.startY) / drag.ratio);
    const offset = clampOffset(slot, drag.origin.x + dx, drag.origin.y + dy);
    setDrag({ ...drag, current: { ...drag.origin, ...offset } });
  };
  const onDragEnd = () => {
    if (!drag) return;
    setDrag(null);
    const { slot, origin, current } = drag;
    if (origin.x !== current.x || origin.y !== current.y) commit(slot, current);
  };
  const nudge = (event: React.KeyboardEvent) => {
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = keys[event.key];
    const slot = open.find((s) => s.name === selected);
    const fill = slot && readFill(value, slot.name);
    if (!step || !slot || !fill) return;
    event.preventDefault();
    const by = event.shiftKey ? 10 : 1;
    commit(slot.name, {
      ...fill,
      ...clampOffset(slot, fill.x + step[0] * by, fill.y + step[1] * by),
    });
  };

  const pick = selected === null ? -1 : indexOf(selected);
  return (
    <div className="@container" data-testid="overlay-slots-composer">
      <div className="grid grid-cols-1 items-start gap-4 @[52rem]:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-w-0 flex-col gap-2.5">
          <div className="card flex flex-wrap items-end gap-3 p-2.5">
            <McScreenControls value={settings} onChange={setSettings} />
            {toolbar}
          </div>
          <div
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage takes the arrow keys that move the chosen image
            tabIndex={0}
            onKeyDown={nudge}
            className="rounded-[var(--r-md)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-line)]"
            aria-label={t("overlaySlots.stage")}
          >
            <McScreen
              width={settings.width}
              height={settings.height}
              guiScale={settings.guiScale}
              zoom={settings.zoom}
            >
              {(geometry) => (
                <Stage
                  projectId={projectId}
                  geometry={geometry}
                  layers={layers}
                  hidden={new Set()}
                  content={content}
                  selected={pick < 0 ? null : pick}
                  sizeOf={sizeOf}
                  label={(layer) => (layer.kind === "image" ? layer.name : label(layer.name))}
                  outOfReach={t("overlayComposer.outOfReach")}
                  onSelect={(index) => {
                    const layer = index === null ? undefined : layers[index];
                    setSelected(layer?.kind === "image_slot" ? layer.name : null);
                  }}
                  onDragStart={(event, index) => startDrag(event, index, geometry)}
                  onDragMove={onDragMove}
                  onDragEnd={onDragEnd}
                  editable={(index) => layers[index]?.kind === "image_slot"}
                />
              )}
            </McScreen>
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-2.5">
          {open.length === 0 && (
            <p className="card p-4 text-[12.5px] text-[var(--text-mut)]">
              {t("overlaySlots.none")}
            </p>
          )}
          {open.map((slot) => {
            const fill = fillOf(slot.name);
            const own = readFill(value, slot.name);
            const on = selected === slot.name;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the card's fields take the keyboard; a click only marks it on the screen
              <div
                key={slot.name}
                className={cx(
                  "card flex flex-col gap-3 p-4",
                  on && "border-[var(--brand-line)] bg-[var(--brand-soft)]",
                )}
                onClick={() => setSelected(slot.name)}
              >
                <span className="eyebrow">{label(slot.name)}</span>
                <AssetInput
                  projectId={projectId}
                  label={t("overlaySlots.image")}
                  value={own?.image ?? ""}
                  clearable
                  onChange={(image) =>
                    commit(slot.name, image ? { image, x: own?.x ?? 0, y: own?.y ?? 0 } : null)
                  }
                />
                {!own && (
                  <p className="text-[12px] text-[var(--text-mut)]">
                    {slot.fallback
                      ? t("overlaySlots.usesDefault", { name: slot.fallback })
                      : t("overlaySlots.empty")}
                  </p>
                )}
                {own && fill && (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <NumberField
                        label={t("overlaySlots.offsetX")}
                        value={fill.x}
                        min={-MAX_OFFSET}
                        max={MAX_OFFSET}
                        onChange={(x) =>
                          commit(slot.name, { ...own, ...clampOffset(slot, x, own.y) })
                        }
                      />
                      <NumberField
                        label={t("overlaySlots.offsetY")}
                        value={fill.y}
                        min={-MAX_OFFSET}
                        max={MAX_OFFSET}
                        onChange={(y) =>
                          commit(slot.name, { ...own, ...clampOffset(slot, own.x, y) })
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="self-start"
                      disabled={!own.x && !own.y}
                      onClick={() => commit(slot.name, { ...own, x: 0, y: 0 })}
                    >
                      <RotateCcw className="size-3.5" />
                      {t("overlaySlots.reset")}
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
