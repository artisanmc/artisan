import { McScreen, McScreenControls, type McScreenSettings, McText } from "@/components/mc-preview";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SortableList } from "@/components/ui/sortable-list";
import { assetPreviewUrl } from "@/domain/asset";
import { AssetInput } from "@/features/assets/AssetInput";
import { useAssetStore } from "@/features/assets/assetStore";
import { cx } from "@/lib/cx";
import { mcLineWidth, wrapLore } from "@/lib/loreWrap";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import {
  type McScreenGeometry,
  OVERLAY_MAX_Y,
  OVERLAY_MIN_Y,
  type OverlayComposerProps,
  type OverlayContent,
  type OverlayLayer,
  type OverlayPreviewContent,
  type OverlaySlotDeclaration,
  overlayLayerBox,
  overlayPlan,
  readOverlayLayout,
  writeOverlayLayer,
} from "@artisan/editor-sdk";
import { Eye, EyeOff, Image as ImageIcon, List, Plus, Trash2, Type, UserRound } from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/** The keys a layer entry owns; anything else in the entry is kept as written. */
const LAYER_KEYS = [
  "image",
  "image_slot",
  "text",
  "list",
  "x",
  "y",
  "width",
  "lines",
  "row",
  "align",
  "anchor",
  "cursor",
];
const MAX_X = 1024;
const MAX_WIDTH = 1024;
const MAX_LINES = 32;

/** `layer` written over its entry: its own keys replaced, the others kept. */
export function writeEntry(entry: unknown, layer: OverlayLayer): Record<string, unknown> {
  const kept = Object.fromEntries(
    Object.entries(entry && typeof entry === "object" ? entry : {}).filter(
      ([k]) => !LAYER_KEYS.includes(k),
    ),
  );
  return { ...kept, ...writeOverlayLayer(layer) };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The y a layer may take: every top it draws (rows, cursor) within the pack's reach. */
export function clampY(layer: OverlayLayer, y: number): number {
  if (layer.kind === "text" || layer.kind === "list") {
    const cy = layer.kind === "list" && layer.cursor ? layer.cursor.y : 0;
    return clamp(
      y,
      OVERLAY_MIN_Y - Math.min(0, cy),
      OVERLAY_MAX_Y - (layer.lines - 1) * layer.row - Math.max(0, cy),
    );
  }
  return clamp(y, OVERLAY_MIN_Y, OVERLAY_MAX_Y);
}

/** The most lines a text or list at its y can show. */
function maxLines(layer: Extract<OverlayLayer, { kind: "text" | "list" }>): number {
  const cy = layer.kind === "list" && layer.cursor ? Math.max(0, layer.cursor.y) : 0;
  return clamp(Math.floor((OVERLAY_MAX_Y - layer.y - cy) / layer.row) + 1, 1, MAX_LINES);
}

/** What fills the layers in the preview: a string cut at the layer's width, as the module cuts it. */
function previewContent(
  layers: readonly OverlayLayer[],
  preview: OverlayPreviewContent | undefined,
): OverlayContent {
  const text: Record<string, readonly string[]> = {};
  for (const layer of layers) {
    if (layer.kind !== "text") continue;
    const value = preview?.text?.[layer.name];
    if (value === undefined) continue;
    text[layer.name] =
      typeof value === "string"
        ? value.split("\n").flatMap((line) => wrapLore(line, layer.width))
        : value;
  }
  const lists: OverlayContent["lists"] = {};
  for (const [name, list] of Object.entries(preview?.lists ?? {}))
    lists[name] = { rows: list.rows, selected: list.selected, top: list.top ?? 0 };
  return { text, lists, images: preview?.images ?? {} };
}

type Drag = {
  index: number;
  mode: "move" | "width" | "lines";
  startX: number;
  startY: number;
  /** Client px per GUI px. */
  ratio: number;
  origin: OverlayLayer;
  current: OverlayLayer;
};

/**
 * A HUD layout edited on the game's screen (SDK 1.16): drag a layer to move it, its handles to
 * resize a text or a list, the arrow keys to nudge it; the layers in a list beside, the selected
 * one's numbers and images on the other side. The value is the layout's YAML list; an entry it
 * cannot read is listed with its problems and written back untouched.
 */
export function OverlayComposer({
  projectId,
  value,
  onChange,
  slots,
  preview,
  toolbar,
}: OverlayComposerProps) {
  const { t } = useTranslation();
  const items = useMemo(() => (Array.isArray(value) ? value : []), [value]);
  const read = useMemo(() => readOverlayLayout(items), [items]);
  const [settings, setSettings] = useState<McScreenSettings>({
    width: 854,
    height: 480,
    guiScale: "auto",
    zoom: "fit",
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picking, setPicking] = useState(false);
  const assets = useAssetStore((s) => s.assets);
  const sizeOf = (name: string) => {
    const asset = assets.find((a) => a.projectId === projectId && a.name === name);
    return asset ? { width: asset.width, height: asset.height } : undefined;
  };

  /** The layer of each entry as shown: the dragged one where the pointer has it. */
  const shown = read.entries.map((e) => (drag && drag.index === e.index ? drag.current : e.layer));
  const layers = shown.filter((l): l is OverlayLayer => !!l);
  const content = previewContent(layers, preview);
  const slotLabel = (name: string) => slots.find((s) => s.name === name)?.label ?? name;

  const commit = (index: number, layer: OverlayLayer) =>
    onChange(items.map((entry, i) => (i === index ? writeEntry(entry, layer) : entry)));
  const add = (entry: Record<string, unknown>) => {
    onChange([...items, entry]);
    setSelected(items.length);
  };
  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
    setSelected(null);
    setHidden(new Set());
  };
  const move = (from: number, to: number) => {
    const next = [...items];
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry);
    onChange(next);
    setSelected(to);
    setHidden(new Set());
  };

  const missingSlots = slots.filter(
    (s) => !read.layers.some((l) => l.kind === s.kind && l.name === s.name),
  );
  const current = selected === null ? null : read.entries[selected];

  const startDrag = (
    event: ReactPointerEvent,
    index: number,
    mode: Drag["mode"],
    geometry: McScreenGeometry,
  ) => {
    const layer = read.entries[index]?.layer;
    if (!layer || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const host = (event.currentTarget as HTMLElement).closest(
      "[data-overlay-stage]",
    ) as HTMLElement | null;
    // The screen is drawn at its zoom by a CSS transform: its rendered width over its own.
    const zoom =
      host && host.offsetWidth > 0 ? host.getBoundingClientRect().width / host.offsetWidth : 1;
    const ratio = (zoom || 1) * geometry.scale;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setSelected(index);
    setDrag({
      index,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      ratio,
      origin: layer,
      current: layer,
    });
  };
  const onDragMove = (event: ReactPointerEvent) => {
    if (!drag) return;
    const dx = Math.round((event.clientX - drag.startX) / drag.ratio);
    const dy = Math.round((event.clientY - drag.startY) / drag.ratio);
    const o = drag.origin;
    let next: OverlayLayer = o;
    if (drag.mode === "move") {
      const x = clamp(o.x + dx, -MAX_X, MAX_X);
      next = { ...o, x, y: clampY(o, o.y + dy) };
    } else if (o.kind === "text" || o.kind === "list") {
      if (drag.mode === "width") next = { ...o, width: clamp(o.width + dx, 1, MAX_WIDTH) };
      else
        next = { ...o, lines: clamp(Math.round((o.lines * o.row + dy) / o.row), 1, maxLines(o)) };
    }
    setDrag({ ...drag, current: next });
  };
  const onDragEnd = () => {
    if (!drag) return;
    const { index, origin, current: layer } = drag;
    setDrag(null);
    if (JSON.stringify(layer) !== JSON.stringify(origin)) commit(index, layer);
  };
  const nudge = (event: React.KeyboardEvent) => {
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = keys[event.key];
    const layer = current?.layer;
    if (!step || !layer || selected === null) return;
    event.preventDefault();
    const by = event.shiftKey ? 10 : 1;
    commit(selected, {
      ...layer,
      x: clamp(layer.x + step[0] * by, -MAX_X, MAX_X),
      y: clampY(layer, layer.y + step[1] * by),
    });
  };

  const ids = read.entries.map((e) => String(e.index));
  return (
    <div className="flex flex-wrap items-start gap-4" data-testid="overlay-composer">
      <aside className="card flex min-w-[220px] max-w-[300px] flex-[1_1_232px] flex-col gap-2.5 p-3.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{t("overlayComposer.layers")}</span>
          <span className="text-[11.5px] text-[var(--text-faint)]">
            {t("overlayComposer.order")}
          </span>
        </div>
        {read.problems.some((p) => p.path === "layout") && (
          <p role="alert" className="text-[12px] text-[var(--danger)]">
            {t("overlayComposer.notAList")}
          </p>
        )}
        <SortableList
          ids={ids}
          onMove={move}
          className="flex flex-col gap-1"
          handleLabel={t("overlayComposer.reorder")}
        >
          {(index, handle) => {
            const entry = read.entries[index]!;
            const layer = shown[index];
            const on = selected === index;
            const off = hidden.has(index);
            return (
              <div
                className={cx(
                  "flex items-center gap-1 rounded-[var(--r-sm)] border pl-1",
                  on ? "border-[var(--brand-line)] bg-[var(--brand-soft)]" : "border-transparent",
                )}
              >
                {handle}
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected(index)}
                  className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <KindIcon kind={layer?.kind} />
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={cx(
                        "truncate text-[13px] font-medium",
                        off && "text-[var(--text-faint)]",
                      )}
                    >
                      {layer ? layerTitle(layer, slotLabel, t) : t("overlayComposer.unreadable")}
                    </span>
                    <span
                      className={cx(
                        "truncate text-[11.5px]",
                        entry.problems.length ? "text-[var(--danger)]" : "text-[var(--text-mut)]",
                      )}
                    >
                      {entry.problems.length
                        ? t("overlayComposer.problem", {
                            code: entry.problems[0]!.code,
                            path: entry.problems[0]!.path,
                          })
                        : layer && t(`overlayComposer.kind.${layer.kind}`)}
                    </span>
                  </span>
                </button>
                {layer && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t(off ? "overlayComposer.show" : "overlayComposer.hide", {
                      name: layerTitle(layer, slotLabel, t),
                    })}
                    onClick={() => {
                      const next = new Set(hidden);
                      if (off) next.delete(index);
                      else next.add(index);
                      setHidden(next);
                    }}
                  >
                    {off ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                )}
              </div>
            );
          }}
        </SortableList>
        {items.length === 0 && (
          <p className="text-[12.5px] text-[var(--text-mut)]">{t("overlayComposer.empty")}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
            <Plus className="size-3.5" />
            {t("overlayComposer.addImage")}
          </Button>
          {missingSlots.map((slot) => (
            <Button
              key={slot.name}
              size="sm"
              variant="outline"
              onClick={() => add(newSlotEntry(slot))}
            >
              <Plus className="size-3.5" />
              {slot.label}
            </Button>
          ))}
        </div>
        {picking && (
          <AddImage
            projectId={projectId}
            onPick={(name) => {
              setPicking(false);
              if (!name) return;
              const width = sizeOf(name)?.width ?? 0;
              add({ image: name, x: 0 - Math.floor(width / 2), y: -40 });
            }}
          />
        )}
      </aside>

      <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-2.5">
        <div className="card flex flex-wrap items-end gap-3 p-2.5">
          <McScreenControls value={settings} onChange={setSettings} />
          {toolbar}
        </div>
        <div
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage takes the arrow keys that nudge the selected layer
          tabIndex={0}
          onKeyDown={nudge}
          className="rounded-[var(--r-md)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-line)]"
          aria-label={t("overlayComposer.stage")}
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
                layers={shown}
                hidden={hidden}
                content={content}
                selected={selected}
                sizeOf={sizeOf}
                label={(layer) => layerTitle(layer, slotLabel, t)}
                outOfReach={t("overlayComposer.outOfReach")}
                onSelect={setSelected}
                onDragStart={(event, index, mode) => startDrag(event, index, mode, geometry)}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
              />
            )}
          </McScreen>
        </div>
        <p className="text-[12px] text-[var(--text-mut)]">{t("overlayComposer.hint")}</p>
      </section>

      <aside className="card flex min-w-[260px] max-w-[340px] flex-[1_1_300px] flex-col gap-3.5 p-4">
        {current ? (
          <LayerPanel
            projectId={projectId}
            entry={current}
            layer={shown[current.index] ?? null}
            slotLabel={slotLabel}
            sizeOf={sizeOf}
            onChange={(layer) => commit(current.index, layer)}
            onRemove={() => remove(current.index)}
          />
        ) : (
          <p className="text-[12.5px] text-[var(--text-mut)]">{t("overlayComposer.pickLayer")}</p>
        )}
      </aside>
    </div>
  );
}

/** A new entry for a named layer the module fills, placed where a conversation's HUD has it. */
function newSlotEntry(slot: OverlaySlotDeclaration): Record<string, unknown> {
  if (slot.kind === "image_slot") return { image_slot: slot.name, x: -180, y: 8, anchor: "bottom" };
  if (slot.kind === "list") return { list: slot.name, x: -110, y: -31, width: 230, lines: 3 };
  return { text: slot.name, x: -120, y: -72, width: 240 };
}

function layerTitle(
  layer: OverlayLayer,
  slotLabel: (name: string) => string,
  t: (key: string) => string,
): string {
  return layer.kind === "image"
    ? layer.name
    : slotLabel(layer.name) || t(`overlayComposer.kind.${layer.kind}`);
}

function KindIcon({ kind }: { kind: OverlayLayer["kind"] | undefined }) {
  const Icon =
    kind === "text" ? Type : kind === "list" ? List : kind === "image_slot" ? UserRound : ImageIcon;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] border border-[var(--border-soft)] bg-[var(--surface-inset)]">
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/** Picks the image of a new layer: the asset input opened on its own. */
function AddImage({ projectId, onPick }: { projectId: string; onPick: (name: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <AssetInput
        projectId={projectId}
        value=""
        label={t("overlayComposer.newImage")}
        onChange={onPick}
      />
      <Button size="sm" variant="ghost" onClick={() => onPick("")}>
        {t("overlayComposer.cancel")}
      </Button>
    </div>
  );
}

/** The layers on the game's screen, from the slot's origin (centre, top of the action bar's text). */
function Stage({
  projectId,
  geometry,
  layers,
  hidden,
  content,
  selected,
  sizeOf,
  label,
  outOfReach,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  projectId: string;
  geometry: McScreenGeometry;
  layers: readonly (OverlayLayer | null)[];
  hidden: ReadonlySet<number>;
  content: OverlayContent;
  selected: number | null;
  sizeOf: (asset: string) => { width: number; height: number } | undefined;
  label: (layer: OverlayLayer) => string;
  outOfReach: string;
  onSelect: (index: number | null) => void;
  onDragStart: (event: ReactPointerEvent, index: number, mode: Drag["mode"]) => void;
  onDragMove: (event: ReactPointerEvent) => void;
  onDragEnd: () => void;
}) {
  const { layout, scale, textLift } = geometry;
  const ox = layout.centerX;
  const oy = layout.actionBarTop;
  // Drawn layers only, each draw knowing its entry.
  const drawable = layers
    .map((layer, index) => ({ layer, index }))
    .filter((e): e is { layer: OverlayLayer; index: number } => !!e.layer && !hidden.has(e.index));
  const plan = overlayPlan(
    drawable.map((e) => e.layer),
    content,
    mcLineWidth,
    (asset) => sizeOf(asset)?.height ?? -1,
  );
  const box = (layer: OverlayLayer) =>
    overlayLayerBox(
      layer,
      sizeOf,
      layer.kind === "image_slot" ? content.images?.[layer.name] : undefined,
    );
  const px = (n: number) => n * scale;
  const reachTop = oy + OVERLAY_MIN_Y;
  const pick = selected === null ? undefined : drawable.find((e) => e.index === selected);
  const pickBox = pick && box(pick.layer);
  const resizable = pick && (pick.layer.kind === "text" || pick.layer.kind === "list");
  const handlers = {
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd,
  };
  return (
    <div
      data-overlay-stage
      style={{ position: "absolute", inset: 0 }}
      onPointerDown={() => onSelect(null)}
    >
      {reachTop > 0 && (
        <div
          className="hatch"
          title={outOfReach}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: px(reachTop),
            borderBottom: "1px dashed var(--text-faint)",
          }}
        />
      )}
      {plan.draws.map((draw) => {
        // A layer draws one piece per kind and height: its image, each row, its cursor.
        const key = `${draw.layer}:${draw.image ? "i" : "t"}:${draw.rise}`;
        const left = px(ox + draw.x);
        const top = px(oy - draw.rise);
        return draw.image ? (
          <StageImage
            key={key}
            projectId={projectId}
            name={draw.content}
            left={left}
            top={top}
            scale={scale}
          />
        ) : (
          <div
            key={key}
            style={{
              position: "absolute",
              left,
              top: top - px(textLift),
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            <McText source={draw.content} scale={scale} />
          </div>
        );
      })}
      {/* An image the project lacks, or a slot with nothing in it: its place, dashed. */}
      {drawable.map(({ layer, index }) => {
        const b = box(layer);
        if (b.width > 0) return null;
        return (
          <div
            key={`place-${index}`}
            style={{
              position: "absolute",
              left: px(ox + b.x),
              top: px(
                oy + b.y - (layer.kind === "image_slot" && layer.anchor === "bottom" ? 24 : 0),
              ),
              width: px(24),
              height: px(24),
              border: "1px dashed var(--text-faint)",
              pointerEvents: "none",
            }}
          />
        );
      })}
      {[...drawable].reverse().map(({ layer, index }) => {
        const b = box(layer);
        const w = Math.max(b.width, 24);
        const h = Math.max(
          b.height,
          layer.kind === "image_slot" && b.height === 0 ? 24 : b.height,
          6,
        );
        const top =
          b.height === 0 && layer.kind === "image_slot" && layer.anchor === "bottom"
            ? b.y - 24
            : b.y;
        return (
          <button
            key={`hit-${index}`}
            type="button"
            aria-label={label(layer)}
            className="cursor-move bg-transparent hover:outline hover:outline-1 hover:outline-dashed hover:outline-[var(--brand-line)]"
            style={{
              position: "absolute",
              left: px(ox + b.x),
              top: px(oy + top),
              width: px(w),
              height: px(h),
              padding: 0,
              border: 0,
            }}
            onPointerDown={(event) => onDragStart(event, index, "move")}
            {...handlers}
          />
        );
      })}
      {pick && pickBox && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: px(ox + pickBox.x),
              top: px(oy + pickBox.y),
              width: px(Math.max(pickBox.width, 1)),
              height: px(Math.max(pickBox.height, 1)),
              outline: "2px solid var(--brand)",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden
            className="rounded-[4px] bg-[var(--brand)] px-1.5 text-[11px] font-semibold text-[var(--brand-fg)]"
            style={{
              position: "absolute",
              left: px(ox + pickBox.x),
              top: Math.max(0, px(oy + pickBox.y) - 20),
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {tag(pick.layer)}
          </div>
          {resizable && (
            <>
              <Handle
                left={px(ox + pickBox.x + pickBox.width) - 4}
                top={px(oy + pickBox.y + pickBox.height / 2) - 11}
                width={8}
                height={22}
                cursor="ew-resize"
                onPointerDown={(event) => onDragStart(event, pick.index, "width")}
                {...handlers}
              />
              <Handle
                left={px(ox + pickBox.x + pickBox.width / 2) - 11}
                top={px(oy + pickBox.y + pickBox.height) - 4}
                width={22}
                height={8}
                cursor="ns-resize"
                onPointerDown={(event) => onDragStart(event, pick.index, "lines")}
                {...handlers}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The selected layer's tag over the screen: where it is, how wide and how many lines. */
function tag(layer: OverlayLayer): string {
  if (layer.kind === "text" || layer.kind === "list")
    return `${layer.name} · ${layer.width} × ${layer.lines}`;
  return `${layer.name} · ${layer.x}, ${layer.y}`;
}

function Handle({
  left,
  top,
  width,
  height,
  cursor,
  ...events
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  cursor: string;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        cursor,
        borderRadius: 3,
        background: "var(--surface)",
        border: "2px solid var(--brand)",
        boxSizing: "border-box",
        touchAction: "none",
      }}
      {...events}
    />
  );
}

/** A Project's image at its size on the screen (scale 1 in GUI px, as the pack draws it). */
function StageImage({
  projectId,
  name,
  left,
  top,
  scale,
}: { projectId: string; name: string; left: number; top: number; scale: number }) {
  const asset = useAssetStore((s) =>
    s.assets.find((a) => a.projectId === projectId && a.name === name),
  );
  const url = useAuthenticatedImageUrl(asset ? assetPreviewUrl(asset) : "");
  if (!asset || !url) return null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        left,
        top,
        width: asset.width * scale,
        height: asset.height * scale,
        imageRendering: "pixelated",
        pointerEvents: "none",
      }}
    />
  );
}

/** The selected layer's numbers, images and options. */
function LayerPanel({
  projectId,
  entry,
  layer,
  slotLabel,
  sizeOf,
  onChange,
  onRemove,
}: {
  projectId: string;
  entry: { index: number; problems: { path: string; code: string; detail: string }[] };
  layer: OverlayLayer | null;
  slotLabel: (name: string) => string;
  sizeOf: (asset: string) => { width: number; height: number } | undefined;
  onChange: (layer: OverlayLayer) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const remove = (
    <Button
      size="sm"
      variant="ghost"
      className="self-start text-[var(--danger)]"
      onClick={onRemove}
    >
      <Trash2 className="size-3.5" />
      {t("overlayComposer.remove")}
    </Button>
  );
  if (!layer)
    return (
      <>
        <span className="eyebrow">{t("overlayComposer.unreadable")}</span>
        <ul className="flex flex-col gap-1 text-[12.5px] text-[var(--danger)]">
          {entry.problems.map((p) => (
            <li key={`${p.path}:${p.code}`}>
              {t("overlayComposer.problem", { code: p.code, path: p.path })}
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-[var(--text-mut)]">{t("overlayComposer.unreadableHint")}</p>
        {remove}
      </>
    );
  const set = (patch: Partial<OverlayLayer>) => onChange({ ...layer, ...patch } as OverlayLayer);
  return (
    <>
      <div>
        <span className="eyebrow">{t(`overlayComposer.kind.${layer.kind}`)}</span>
        <h3 className="mt-0.5 text-[16px] font-semibold">{layerTitle(layer, slotLabel, t)}</h3>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <NumberField
          label="X"
          value={layer.x}
          min={-MAX_X}
          max={MAX_X}
          onChange={(x) => set({ x })}
        />
        <NumberField
          label="Y"
          value={layer.y}
          min={OVERLAY_MIN_Y}
          max={OVERLAY_MAX_Y}
          onChange={(y) => set({ y: clampY(layer, y) })}
        />
      </div>
      {(layer.kind === "text" || layer.kind === "list") && (
        <div className="grid grid-cols-3 gap-2.5">
          <NumberField
            label={t("overlayComposer.width")}
            value={layer.width}
            min={1}
            max={MAX_WIDTH}
            onChange={(width) => set({ width })}
          />
          <NumberField
            label={t("overlayComposer.lines")}
            value={layer.lines}
            min={1}
            max={maxLines(layer)}
            onChange={(lines) => set({ lines })}
          />
          <NumberField
            label={t("overlayComposer.row")}
            value={layer.row}
            min={1}
            max={64}
            onChange={(row) => {
              const next = { ...layer, row };
              onChange({ ...next, lines: Math.min(layer.lines, maxLines(next)) });
            }}
          />
        </div>
      )}
      {layer.kind === "text" && (
        <Segmented
          label={t("overlayComposer.align")}
          value={layer.align}
          onChange={(align) => set({ align })}
          options={(["left", "center", "right"] as const).map((v) => ({
            value: v,
            label: t(`overlayComposer.aligns.${v}`),
          }))}
        />
      )}
      {layer.kind === "text" && (
        <p className="text-[12px] text-[var(--text-mut)]">{t("overlayComposer.textHint")}</p>
      )}
      {layer.kind === "list" && (
        <div className="flex flex-col gap-2">
          {layer.cursor ? (
            <>
              <AssetInput
                projectId={projectId}
                label={t("overlayComposer.cursor")}
                value={layer.cursor.image}
                clearable
                onChange={(image) => set({ cursor: image ? { ...layer.cursor!, image } : null })}
              />
              <div className="grid grid-cols-2 gap-2.5">
                <NumberField
                  label={t("overlayComposer.cursorX")}
                  value={layer.cursor.x}
                  min={-64}
                  max={64}
                  onChange={(x) => set({ cursor: { ...layer.cursor!, x } })}
                />
                <NumberField
                  label={t("overlayComposer.cursorY")}
                  value={layer.cursor.y}
                  min={-64}
                  max={64}
                  onChange={(y) => set({ cursor: { ...layer.cursor!, y } })}
                />
              </div>
            </>
          ) : (
            <AssetInput
              projectId={projectId}
              label={t("overlayComposer.cursor")}
              value=""
              onChange={(image) => image && set({ cursor: { image, x: -10, y: 1 } })}
            />
          )}
          <p className="text-[12px] text-[var(--text-mut)]">{t("overlayComposer.listHint")}</p>
        </div>
      )}
      {layer.kind === "image" && (
        <>
          <AssetInput
            projectId={projectId}
            label={t("overlayComposer.image")}
            value={layer.name}
            onChange={(name) => name && set({ name })}
          />
          <p className="text-[12px] text-[var(--text-mut)]">
            {sizeOf(layer.name)
              ? t("overlayComposer.imageHint")
              : t("overlayComposer.imageMissing")}
          </p>
        </>
      )}
      {layer.kind === "image_slot" && (
        <>
          <p className="text-[12.5px] text-[var(--text-mut)]">{t("overlayComposer.slotHint")}</p>
          <div className="flex flex-col gap-1">
            <span className="field-label">{t("overlayComposer.anchor")}</span>
            <Segmented
              label={t("overlayComposer.anchor")}
              value={layer.anchor}
              onChange={(anchor) => set({ anchor })}
              options={(["bottom", "top"] as const).map((v) => ({
                value: v,
                label: t(`overlayComposer.anchors.${v}`),
              }))}
            />
          </div>
        </>
      )}
      {(layer.kind === "image" ||
        layer.kind === "image_slot" ||
        (layer.kind === "list" && layer.cursor)) && (
        <p className="rounded-[var(--r-sm)] border border-[var(--warning)] bg-[var(--warning-soft)] px-3 py-2 text-[12px]">
          {t("overlayComposer.packHint")}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-1 border-t border-[var(--border-soft)] pt-3">
        <span className="field-label">{t("overlayComposer.slot")}</span>
        <code className="mono text-[12.5px]">
          {layer.kind === "image" ? t("overlayComposer.fixed") : layer.name}
        </code>
      </div>
      {remove}
    </>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="field-label flex flex-col gap-1">
      {label}
      <input
        ref={ref}
        type="number"
        className="input"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const n = Number.parseInt(event.target.value, 10);
          if (Number.isInteger(n)) onChange(clamp(n, min, max));
        }}
      />
    </label>
  );
}
