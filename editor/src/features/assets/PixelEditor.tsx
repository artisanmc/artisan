import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { uploadAsset } from "@/lib/api/userAssets";
import { cx } from "@/lib/cx";
import { type RgbaImage, decodePng, encodePng } from "@/lib/pack/png";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type DrawTool,
  StageMessage,
  type StudioKeyEvent,
  type StudioTool,
  StudioTools,
  UndoControls,
  ZoomControls,
  toolOfKey,
  undoKey,
  useStageZoom,
} from "./StudioFrame";
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

/** From this zoom on, the pixels are outlined. */
const GRID_FROM = 6;
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

/** What the pixel editor gives the atelier to place (`StudioFrame`), and to save with. */
export interface PixelParts {
  rail: ReactNode;
  stage: ReactNode;
  status: ReactNode;
  /** Undo, redo, zoom. */
  controls: ReactNode;
  /** The colour drawn with and the palettes: the content of a section. */
  colour: ReactNode;
  keys?: (event: StudioKeyEvent) => void;
  /** The image as it is drawn now, a data URL; empty while it is read. */
  picture: string;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  /** Saves the pixels when they changed. `false` when the save failed: they are kept here. */
  save: () => Promise<boolean>;
  discard: () => void;
}

/**
 * An image drawn pixel by pixel in the atelier: pencil, eraser, pipette, paint bucket, a
 * palette of its own colours and the common images', zoom, undo. The image keeps its size.
 * What is saved is a PNG of the same size under the same name (`uploadAsset`'s `retouch`), so
 * the menus that show it need nothing. It renders nothing by itself: `layout` places its
 * parts, and the tool in hand is the atelier's.
 */
export function PixelEditor({
  projectId,
  asset,
  tool,
  onTool,
  move,
  within,
  around,
  layout,
}: {
  projectId: ProjectId;
  asset: Asset;
  /** The tool in hand. */
  tool: DrawTool;
  /** Another tool is asked for; `move` once the pixels are saved, since it leaves the drawing. */
  onTool: (tool: StudioTool) => void;
  /** Why the image cannot be moved: it is not a layer among others. */
  move?: string;
  /**
   * The image this one is a layer of, and where it sits in it: the whole image is shown, and
   * only the layer's area is drawn on.
   */
  within?: { width: number; height: number; x: number; y: number };
  /**
   * What the image is drawn among, at the editor's zoom: `under` it and `over` it, placed from
   * the top left corner of the image shown (`within`, else this one) and out of the pointer's
   * way. `picture` is the image as it is drawn now.
   */
  around?: (zoom: number, picture: string) => { under: ReactNode; over: ReactNode };
  layout: (parts: PixelParts) => ReactNode;
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
  const [colour, setColour] = useState<Rgba>(BLACK);
  const [hex, setHex] = useState(toHex(BLACK));
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

  const current = image.current;
  // The whole image when this one is a layer of it: moving and drawing show it at one size.
  const shown = within ?? (current ? { width: current.width, height: current.height } : null);
  const view = useStageZoom(shown, {
    fallback: shown ? 256 / Math.max(shown.width, shown.height) : 1,
    whole: true,
  });
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

  if (failed || !current) {
    // Nothing to draw on yet: the atelier's page stays, with the way back.
    return layout({
      rail: <StudioTools value={tool} onChange={onTool} move={move} />,
      stage: (
        <StageMessage danger={failed}>
          {t(failed ? "pixel.unreadable" : "pixel.loading")}
        </StageMessage>
      ),
      status: null,
      controls: null,
      colour: null,
      picture: "",
      dirty: false,
      busy: false,
      error: null,
      save: async () => true,
      discard: () => {},
    });
  }

  const zoom = view.zoom;

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
      if (found[3] === 0) onTool("eraser");
      else {
        pick(found);
        if (tool === "pipette") onTool("pencil");
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

  const onKeyDown = (event: StudioKeyEvent) => {
    // The editor's own undo, not the project's.
    const history = undoKey(event);
    if (history === "undo") undo();
    else if (history === "redo") redo();
    if (history || event.ctrlKey || event.metaKey || event.altKey) return;
    const chosen = toolOfKey(event.key);
    if (chosen) void choose(chosen);
  };

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!user || busy) return false;
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
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  /** Moving leaves the drawing: what was drawn is saved first, and kept here if that fails. */
  const choose = async (next: StudioTool) => {
    if (next === "move") {
      if (move || !(await save())) return;
    }
    onTool(next);
  };
  const discard = () => {
    if (!saved.current) return;
    record(copyImage(current));
    current.data.set(saved.current.data);
    bump();
  };

  const side = { width: current.width * zoom, height: current.height * zoom };
  const box = within ?? { width: current.width, height: current.height, x: 0, y: 0 };
  const context = around?.(zoom, picture);
  return layout({
    keys: onKeyDown,
    picture,
    dirty,
    busy,
    error,
    save,
    discard,
    rail: (
      <StudioTools
        value={tool}
        onChange={(next) => void choose(next)}
        move={move}
        footer={
          <input
            type="color"
            aria-label={t("pixel.anyColour")}
            title={t("pixel.anyColour")}
            value={toHex(colour).slice(0, 7)}
            onChange={(event) => {
              const chosen = fromHex(event.target.value);
              if (chosen) pick(chosen);
            }}
            className="mt-1 size-8 cursor-pointer rounded-[6px] border border-[var(--border)] bg-transparent p-0"
          />
        }
      />
    ),
    controls: (
      <div className="flex items-center gap-1">
        <UndoControls
          canUndo={undone.current.length > 0}
          canRedo={redone.current.length > 0}
          onUndo={undo}
          onRedo={redo}
        />
        <ZoomControls view={view} />
      </div>
    ),
    stage: (
      <div
        ref={view.ref}
        className="checker flex min-h-0 flex-1 overflow-auto p-4"
        data-testid="pixel-editor"
      >
        <div
          className="relative m-auto shrink-0 overflow-hidden outline outline-1 outline-[var(--border-strong)]"
          style={{ width: box.width * zoom, height: box.height * zoom }}
        >
          {context?.under}
          <button
            type="button"
            aria-label={t("pixel.canvas", { name: asset.name })}
            data-testid="pixel-canvas"
            className={cx(
              "absolute block cursor-crosshair touch-none border-0 bg-transparent p-0 outline-offset-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--brand)]",
              // A layer smaller than its image: where it can be drawn on is outlined.
              within &&
                (current.width !== within.width || current.height !== within.height) &&
                "outline outline-1 outline-dashed outline-[var(--text)]",
            )}
            style={{ ...side, left: box.x * zoom, top: box.y * zoom }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              src={picture}
              alt=""
              draggable={false}
              className="pointer-events-none relative block max-w-none select-none"
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
          {context?.over}
        </div>
      </div>
    ),
    status: (
      <>
        <span>{t("pixel.hint")}</span>
        <span className="shrink-0">
          {box.width} × {box.height} px · {t("resources.zoom", { scale: zoom })}
        </span>
      </>
    ),
    colour: (
      <div className="flex flex-col gap-3">
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
        </div>
        <Swatches label={t("pixel.ownColours")} palette={own} current={colour} onPick={pick} />
        <Swatches
          label={t("pixel.kitColours")}
          palette={kitColours}
          current={colour}
          onPick={pick}
        />
      </div>
    ),
  });
}
