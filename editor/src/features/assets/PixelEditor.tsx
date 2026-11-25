import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { uploadAsset } from "@/lib/api/userAssets";
import { cx } from "@/lib/cx";
import { type RgbaImage, decodePng, encodePng } from "@/lib/pack/png";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { Eraser, PaintBucket, Pencil, Pipette, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetBytes } from "./assetBytes";
import { useAssetStore } from "./assetStore";
import { toDataUrl } from "./composedAssets";
import { useKitAssets } from "./kitAssets";
import {
  type Rgba,
  TRANSPARENT,
  colours,
  copyImage,
  fill,
  fromHex,
  inside,
  mergeColours,
  paintLine,
  pixelAt,
  sameColour,
  sameImage,
  toHex,
} from "./pixelTools";

type Tool = "pencil" | "eraser" | "pipette" | "fill";

const TOOLS: readonly { tool: Tool; key: string; icon: typeof Pencil }[] = [
  { tool: "pencil", key: "b", icon: Pencil },
  { tool: "eraser", key: "e", icon: Eraser },
  { tool: "pipette", key: "i", icon: Pipette },
  { tool: "fill", key: "g", icon: PaintBucket },
];

const MAX_ZOOM = 32;
/** From this zoom on, the pixels are outlined. */
const GRID_FROM = 6;
/** How much of the window's height the image may take. */
const STAGE_HEIGHT = 0.6;
/** Strokes kept to undo. */
const HISTORY = 50;
const IMAGE_COLOURS = 24;
const KIT_COLOURS = 32;
/** Colours taken from each kit image: its body, its edges, its shade. */
const PER_KIT_IMAGE = 6;

const BLACK: Rgba = [0, 0, 0, 255];

const kitPalettes = new Map<string, Promise<Rgba[]>>();

/** The colours of the server's kit, a few from each image: what a retouch stays coherent with. */
function useKitColours(): Rgba[] {
  const kit = useKitAssets();
  const [palette, setPalette] = useState<Rgba[]>([]);
  useEffect(() => {
    if (kit.length === 0) return;
    const key = kit.map((asset) => `${asset.id}@${asset.contentHash}`).join("|");
    let live = true;
    if (!kitPalettes.has(key))
      kitPalettes.set(
        key,
        Promise.all(
          kit.map((asset) =>
            assetBytes(asset)
              .then((bytes) => colours(decodePng(bytes), PER_KIT_IMAGE))
              .catch(() => [] as Rgba[]),
          ),
        ).then((lists) => mergeColours(lists, KIT_COLOURS)),
      );
    void kitPalettes.get(key)?.then((found) => {
      if (live) setPalette(found);
    });
    return () => {
      live = false;
    };
  }, [kit]);
  return palette;
}

function Swatches({
  label,
  palette,
  current,
  onPick,
}: {
  label: string;
  palette: Rgba[];
  current: Rgba;
  onPick: (colour: Rgba) => void;
}) {
  if (palette.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="field-label">{label}</span>
      <div className="flex flex-wrap gap-1">
        {palette.map((colour) => {
          const hex = toHex(colour);
          return (
            <button
              key={hex}
              type="button"
              title={hex}
              aria-label={hex}
              aria-pressed={sameColour(colour, current)}
              onClick={() => onPick(colour)}
              className={cx(
                "checker size-5 cursor-pointer overflow-hidden rounded-[4px] border p-0",
                sameColour(colour, current)
                  ? "border-[var(--brand)] outline outline-1 outline-[var(--brand)]"
                  : "border-[var(--border)]",
              )}
            >
              <span className="block size-full" style={{ backgroundColor: hex }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * An image retouched pixel by pixel, in place of its plain view: pencil, eraser, pipette, paint
 * bucket, a palette of its own colours and the kit's, zoom, undo. Modest on purpose: no layers,
 * no selection, and the image keeps its size. What is saved is a PNG of the same size under the
 * same name (`uploadAsset`'s `retouch`), so the menus that show it need nothing.
 */
export function PixelEditor({
  projectId,
  asset,
  onClose,
}: {
  projectId: ProjectId;
  asset: Asset;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const user = useProjectPrincipalId(projectId);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const kitColours = useKitColours();

  // The image is changed in place, stroke after stroke; `version` says it changed.
  const image = useRef<RgbaImage | null>(null);
  const saved = useRef<RgbaImage | null>(null);
  const undone = useRef<RgbaImage[]>([]);
  const redone = useRef<RgbaImage[]>([]);
  const stroke = useRef<{
    before: RgbaImage;
    last: { x: number; y: number };
    colour: Rgba;
    changed: boolean;
  } | null>(null);
  /** The content this editor wrote last: the asset coming back with it is not read again. */
  const written = useRef<string | null>(null);
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [tool, setTool] = useState<Tool>("pencil");
  const [colour, setColour] = useState<Rgba>(BLACK);
  const [hex, setHex] = useState(toHex(BLACK));
  const [zoomChoice, setZoomChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bump = () => setVersion((n) => n + 1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when the file changes, not when the asset object does
  useEffect(() => {
    if (written.current === asset.contentHash) return;
    let live = true;
    image.current = null;
    setFailed(false);
    assetBytes(asset)
      .then((bytes) => {
        if (!live) return;
        const read = decodePng(bytes);
        image.current = read;
        saved.current = copyImage(read);
        undone.current = [];
        redone.current = [];
        const first = colours(read, 1)[0];
        if (first) pick(first);
        bump();
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [asset.projectId, asset.id, asset.contentHash]);

  // The frame is not there while the image is read: measured once it is.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);

  const current = image.current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is what says the pixels changed
  const picture = useMemo(() => (current ? toDataUrl(encodePng(current)) : ""), [current, version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: same
  const own = useMemo(() => (current ? colours(current, IMAGE_COLOURS) : []), [current, version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: same
  const dirty = useMemo(
    () => !!current && !!saved.current && !sameImage(current, saved.current),
    [current, version],
  );

  function pick(next: Rgba) {
    setColour(next);
    setHex(toHex(next));
  }

  if (failed) return <p className="text-xs text-[var(--danger)]">{t("pixel.unreadable")}</p>;
  if (!current) return <p className="text-xs text-[var(--text-mut)]">{t("pixel.loading")}</p>;

  const fit = width
    ? Math.min(width / current.width, (window.innerHeight * STAGE_HEIGHT) / current.height)
    : 256 / Math.max(current.width, current.height);
  const zoom = zoomChoice ?? Math.min(MAX_ZOOM, Math.max(1, Math.floor(fit)));

  const record = (before: RgbaImage) => {
    undone.current = [...undone.current.slice(1 - HISTORY), before];
    redone.current = [];
  };
  const step = (from: typeof undone, to: typeof undone) => {
    const back = from.current.at(-1);
    if (!back) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, copyImage(current)];
    current.data.set(back.data);
    bump();
  };
  const undo = () => step(undone, redone);
  const redo = () => step(redone, undone);

  const at = (event: PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // One pixel past each edge at most: a stroke that leaves the image stops at its border.
    const bound = (value: number, max: number) => Math.min(max, Math.max(-1, Math.floor(value)));
    return {
      x: bound((event.clientX - rect.left) / zoom, current.width),
      y: bound((event.clientY - rect.top) / zoom, current.height),
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // The shortcuts follow the focus: drawing takes it.
    event.currentTarget.focus();
    const point = at(event);
    const using = event.altKey ? "pipette" : tool;
    if (using === "pipette") {
      if (!inside(current, point.x, point.y)) return;
      const found = pixelAt(current, point.x, point.y);
      // Nothing to pick on a transparent pixel but the eraser.
      if (found[3] === 0) setTool("eraser");
      else {
        pick(found);
        if (tool === "pipette") setTool("pencil");
      }
      return;
    }
    if (using === "fill") {
      const before = copyImage(current);
      if (fill(current, point.x, point.y, colour)) {
        record(before);
        bump();
      }
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const ink = using === "eraser" ? TRANSPARENT : colour;
    const before = copyImage(current);
    const changed = paintLine(current, point, point, ink);
    stroke.current = { before, last: point, colour: ink, changed };
    if (changed) bump();
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drawing = stroke.current;
    if (!drawing) return;
    const point = at(event);
    if (point.x === drawing.last.x && point.y === drawing.last.y) return;
    if (paintLine(current, drawing.last, point, drawing.colour)) {
      drawing.changed = true;
      bump();
    }
    drawing.last = point;
  };
  const onPointerUp = () => {
    const drawing = stroke.current;
    stroke.current = null;
    if (drawing?.changed) {
      record(drawing.before);
      bump();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === "z" && !event.shiftKey) undo();
      else if (key === "y" || (key === "z" && event.shiftKey)) redo();
      else return;
      // The editor's own undo, not the project's.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const chosen = TOOLS.find((entry) => entry.key === key);
    if (chosen) setTool(chosen.tool);
  };

  const save = async () => {
    if (!user || busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = encodePng(current);
      const next = await uploadAsset(projectId, {
        file: new File([bytes as Uint8Array<ArrayBuffer>], `${asset.name}.png`, {
          type: "image/png",
        }),
        type: asset.type,
        name: asset.name,
        retouch: true,
      });
      written.current = next.contentHash;
      saved.current = copyImage(current);
      upsertAsset(next);
      bump();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    if (!saved.current) return;
    record(copyImage(current));
    current.data.set(saved.current.data);
    bump();
  };

  const side = { width: current.width * zoom, height: current.height * zoom };
  return (
    <div className="flex flex-col gap-3" data-testid="pixel-editor" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={t("pixel.tools")}
          value={tool}
          onChange={setTool}
          options={TOOLS.map(({ tool: value, key, icon: Icon }) => ({
            value,
            title: `${t(`pixel.${value}`)} (${key.toUpperCase()})`,
            label: (
              <>
                <Icon className="size-4" aria-hidden />
                <span className="sr-only">{t(`pixel.${value}`)}</span>
              </>
            ),
          }))}
        />
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t("pixel.undo")}
            title={`${t("pixel.undo")} (Ctrl+Z)`}
            disabled={undone.current.length === 0}
            onClick={undo}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t("pixel.redo")}
            title={`${t("pixel.redo")} (Ctrl+Y)`}
            disabled={redone.current.length === 0}
            onClick={redo}
          >
            <Redo2 className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t("pixel.zoomOut")}
            disabled={zoom <= 1}
            onClick={() => setZoomChoice(Math.max(1, zoom - (zoom > 8 ? 2 : 1)))}
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t("pixel.zoomIn")}
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoomChoice(Math.min(MAX_ZOOM, zoom + (zoom >= 8 ? 2 : 1)))}
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>
      </div>

      <figure className="flex flex-col gap-1">
        <div
          ref={setFrame}
          className="checker flex max-h-[60vh] min-h-32 w-full overflow-auto rounded-[var(--r-md)] border border-[var(--border-soft)] p-3"
        >
          <button
            type="button"
            aria-label={t("pixel.canvas", { name: asset.name })}
            data-testid="pixel-canvas"
            className="relative m-auto block shrink-0 cursor-crosshair touch-none border-0 bg-transparent p-0 outline outline-1 outline-[var(--border-strong)] focus-visible:outline-[var(--brand)]"
            style={side}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              src={picture}
              alt=""
              draggable={false}
              className="pointer-events-none block max-w-none select-none"
              style={{ ...side, imageRendering: "pixelated" }}
            />
            {zoom >= GRID_FROM && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, var(--border-strong) 1px, transparent 1px), linear-gradient(to bottom, var(--border-strong) 1px, transparent 1px)",
                  backgroundSize: `${zoom}px ${zoom}px`,
                }}
              />
            )}
          </button>
        </div>
        <figcaption className="flex justify-between gap-2 text-[11px] text-[var(--text-faint)]">
          <span>{t("pixel.hint")}</span>
          <span className="shrink-0">
            {current.width} × {current.height} px · {t("resources.zoom", { scale: zoom })}
          </span>
        </figcaption>
      </figure>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className="field-label">{t("pixel.colour")}</span>
          <div className="flex items-center gap-1.5">
            <span
              className="checker block size-7 shrink-0 overflow-hidden rounded-[6px] border border-[var(--border)]"
              data-testid="pixel-colour"
              title={toHex(colour)}
            >
              <span className="block size-full" style={{ backgroundColor: toHex(colour) }} />
            </span>
            <Input
              aria-label={t("pixel.colour")}
              value={hex}
              spellCheck={false}
              onChange={(event) => {
                setHex(event.target.value);
                const typed = fromHex(event.target.value);
                if (typed) setColour(typed);
              }}
              onBlur={() => setHex(toHex(colour))}
              className="h-7 w-24 font-mono text-xs"
            />
            <input
              type="color"
              aria-label={t("pixel.anyColour")}
              title={t("pixel.anyColour")}
              value={toHex(colour).slice(0, 7)}
              onChange={(event) => {
                const chosen = fromHex(event.target.value);
                if (chosen) pick(chosen);
              }}
              className="size-7 cursor-pointer rounded-[6px] border border-[var(--border)] bg-transparent p-0"
            />
          </div>
        </div>
      </div>
      <Swatches label={t("pixel.ownColours")} palette={own} current={colour} onPick={pick} />
      <Swatches label={t("pixel.kitColours")} palette={kitColours} current={colour} onPick={pick} />

      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {dirty && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={discard}>
            {t("pixel.discard")}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={onClose}>
          {t("pixel.close")}
        </Button>
        <Button size="sm" disabled={busy || !dirty || !user} onClick={() => void save()}>
          {t(busy ? "compose.saving" : "pixel.save")}
        </Button>
      </div>
    </div>
  );
}
