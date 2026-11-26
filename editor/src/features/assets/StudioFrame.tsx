import { Button } from "@/components/ui/button";
import { type RailTool, ToolRail } from "@/components/ui/tool-rail";
import { isTypingTarget } from "@/lib/keyboard";
import {
  ChevronLeft,
  Eraser,
  Move,
  PaintBucket,
  Pencil,
  Pipette,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";

/** A tool that draws on a layer's pixels. */
export type DrawTool = "pencil" | "eraser" | "pipette" | "fill";
/** A tool of the atelier: moving a layer, or drawing on one. */
export type StudioTool = "move" | DrawTool;

const TOOLS: readonly { tool: StudioTool; key: string; icon: RailTool<StudioTool>["icon"] }[] = [
  { tool: "move", key: "v", icon: Move },
  { tool: "pencil", key: "b", icon: Pencil },
  { tool: "eraser", key: "e", icon: Eraser },
  { tool: "pipette", key: "i", icon: Pipette },
  { tool: "fill", key: "g", icon: PaintBucket },
];

/** The tool a key picks (V, B, E, I, G), when it is one. */
export const toolOfKey = (key: string): StudioTool | undefined =>
  TOOLS.find((entry) => entry.key === key.toLowerCase())?.tool;

/**
 * The atelier's tools, on its left: moving a layer, then what draws. `move` and `draw` say
 * why moving or drawing is not possible now; `footer` sits under the tools.
 */
export function StudioTools({
  value,
  onChange,
  move,
  draw,
  footer,
}: {
  value: StudioTool;
  onChange: (tool: StudioTool) => void;
  /** Why no layer can be moved. */
  move?: string;
  /** Why nothing can be drawn on. */
  draw?: string;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <ToolRail
      label={t("pixel.tools")}
      value={value}
      onChange={onChange}
      footer={footer}
      tools={TOOLS.map(({ tool, key, icon }) => ({
        value: tool,
        label: t(tool === "move" ? "studio.move" : `pixel.${tool}`),
        shortcut: key.toUpperCase(),
        icon,
        disabled: tool === "move" ? move : draw,
      }))}
    />
  );
}

/** A key pressed in the atelier: what its editors read of it. */
export type StudioKeyEvent = Pick<
  globalThis.KeyboardEvent,
  | "key"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "altKey"
  | "target"
  | "preventDefault"
  | "stopPropagation"
>;

/** What an editor of the atelier gives the frame to place (`StudioFrame`). */
export interface StudioParts {
  /** The tools, on the left. */
  rail: ReactNode;
  /** The image, in the middle: it takes the room that is left. */
  stage: ReactNode;
  /** Under the image: a hint, and the image's size. */
  status: ReactNode;
  /** In the bar, after the name: undo, redo, zoom. */
  controls: ReactNode;
  /** At the end of the bar: what failed, discard, save. */
  actions: ReactNode;
  /** The right column's sections (`StudioSection`), top to bottom. */
  panels: ReactNode;
  /** The image as a player sees it, last in the right column. */
  preview: ReactNode;
  /** The atelier's keys: tools, undo. Heard on the whole page while the atelier is open. */
  keys?: (event: StudioKeyEvent) => void;
}

/** One section of the atelier's right column. */
export function StudioSection({
  title,
  aside,
  children,
  testId,
}: {
  title: string;
  /** Beside the title, at the end of its line. */
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="flex flex-col gap-2 border-b border-[var(--border-soft)] px-3 py-3"
      data-testid={testId}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The atelier's page, laid out as a drawing program: a bar (back, the image's name, undo and
 * zoom, save), the tools on the left, the image in the middle, and on the right the layers,
 * what the selected one and the tool in hand need, the guides, the preview.
 */
export function StudioFrame({
  back,
  onBack,
  title,
  subtitle,
  parts,
  guides,
}: {
  back: string;
  onBack: () => void;
  title: string;
  subtitle: string;
  parts: StudioParts;
  /** The guides' section, placed before the preview. */
  guides?: ReactNode;
}) {
  // The keys are the atelier's wherever the focus is, a click on the page's edge included:
  // heard before the project's own undo (capture), which they replace while it is open.
  const keys = useRef(parts.keys);
  keys.current = parts.keys;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // A dialog over the atelier keeps its keys.
      if ((event.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return;
      keys.current?.(event);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto lg:overflow-hidden"
      data-testid="image-studio"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" />
          {back}
        </Button>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="truncate text-[11px] text-[var(--text-mut)]">{subtitle}</span>
        </div>
        {parts.controls}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{parts.actions}</div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex shrink-0 justify-center border-b border-[var(--border-soft)] bg-[var(--surface)] p-1.5 lg:border-r lg:border-b-0">
          {parts.rail}
        </div>
        <div className="flex min-h-[340px] min-w-0 flex-1 flex-col bg-[var(--surface-inset)]">
          {parts.stage}
          <div className="flex shrink-0 justify-between gap-3 border-t border-[var(--border-soft)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--text-faint)]">
            {parts.status}
          </div>
        </div>
        <aside className="flex shrink-0 flex-col border-t border-[var(--border-soft)] bg-[var(--surface)] lg:w-[376px] lg:overflow-y-auto lg:border-t-0 lg:border-l">
          {parts.panels}
          {guides}
          {parts.preview}
        </aside>
      </div>
    </div>
  );
}

/** The middle of the atelier when there is no image to show: a line that says why. */
export function StageMessage({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <p className={`text-xs ${danger ? "text-[var(--danger)]" : "text-[var(--text-mut)]"}`}>
        {children}
      </p>
    </div>
  );
}

/** What failed, discard, save: the end of the atelier's bar. */
export function SaveActions({
  dirty,
  busy,
  canSave,
  error,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  busy: boolean;
  canSave: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {error ? (
        <span role="alert" className="max-w-xs text-xs text-[var(--danger)]">
          {error}
        </span>
      ) : null}
      {dirty ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
          {t("studio.discard")}
        </Button>
      ) : null}
      <Button size="sm" variant="primary" disabled={busy || !dirty || !canSave} onClick={onSave}>
        {t(busy ? "compose.saving" : "studio.save")}
      </Button>
    </>
  );
}

const MAX_ZOOM = 32;

/**
 * The zoom chosen by hand in the atelier, `null` while the image is fitted to the room it
 * has. Kept beside the editors: moving a layer and drawing on it show the image at the same
 * size.
 */
export const useStudioView = create<{
  zoom: number | null;
  setZoom: (zoom: number | null) => void;
}>((set) => ({ zoom: null, setZoom: (zoom) => set({ zoom }) }));

export interface StageZoom {
  /** Given to the element the image is shown in: its room is measured. */
  ref: (element: HTMLDivElement | null) => void;
  /** Screen pixels for one pixel of the image. */
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  /** Back to the fitted size; `undefined` when the image is fitted already. */
  fit?: () => void;
}

/**
 * The size an image of `size` is shown at in the atelier's stage: the largest whole number of
 * screen pixels for one of its own that fits the room (`fallback` until the room is
 * measured), unless one was chosen by hand. `whole`: never under 1, for what is drawn pixel
 * by pixel; otherwise an image larger than the room is shown smaller than the game's.
 */
export function useStageZoom(
  size: { width: number; height: number } | null,
  options: { fallback: number; whole?: boolean },
): StageZoom {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRoom({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);
  const choice = useStudioView((s) => s.zoom);
  const setZoom = useStudioView((s) => s.setZoom);

  const fit =
    size && room && room.width > 0 && room.height > 0
      ? Math.min(room.width / size.width, room.height / size.height)
      : options.fallback;
  const fitted = fit >= 1 || options.whole ? Math.min(MAX_ZOOM, Math.max(1, Math.floor(fit))) : fit;
  const zoom = choice ?? fitted;
  const whole = Math.round(zoom);
  return {
    ref: setFrame,
    zoom,
    zoomIn: () => setZoom(Math.min(MAX_ZOOM, zoom < 1 ? 1 : whole + (whole >= 8 ? 2 : 1))),
    zoomOut: () => setZoom(Math.max(1, whole - (whole > 8 ? 2 : 1))),
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > 1,
    fit: choice === null ? undefined : () => setZoom(null),
  };
}

/** Smaller, the size the image is shown at (a click fits it again), larger. */
export function ZoomControls({ view }: { view: StageZoom }) {
  const { t } = useTranslation();
  const scale = view.zoom >= 1 ? String(Math.round(view.zoom)) : view.zoom.toFixed(2);
  return (
    <div className="flex items-center gap-0.5">
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={t("pixel.zoomOut")}
        disabled={!view.canZoomOut}
        onClick={view.zoomOut}
      >
        <ZoomOut className="size-4" />
      </Button>
      <button
        type="button"
        className="min-w-12 rounded-[var(--r-sm)] border-0 bg-transparent px-1 py-0.5 text-center font-mono text-[11px] text-[var(--text-mut)] enabled:cursor-pointer enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-[var(--text)]"
        title={t("studio.fit")}
        aria-label={t("studio.fit")}
        disabled={!view.fit}
        onClick={view.fit}
      >
        ×{scale}
      </button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={t("pixel.zoomIn")}
        disabled={!view.canZoomIn}
        onClick={view.zoomIn}
      >
        <ZoomIn className="size-4" />
      </Button>
    </div>
  );
}

/** Undo and redo, in the atelier's bar, before the zoom. */
export function UndoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={t("pixel.undo")}
        title={`${t("pixel.undo")} (Ctrl+Z)`}
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={t("pixel.redo")}
        title={`${t("pixel.redo")} (Ctrl+Y)`}
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className="size-4" />
      </Button>
      <span aria-hidden className="mx-1 h-4 w-px bg-[var(--border)]" />
    </>
  );
}

/**
 * Whether a key is the atelier's undo (Ctrl+Z) or redo (Ctrl+Y, Ctrl+Shift+Z); the key is then
 * the atelier's alone, the project's undo does not hear it.
 */
export function undoKey(event: StudioKeyEvent): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  const which =
    key === "z" && !event.shiftKey
      ? "undo"
      : key === "y" || (key === "z" && event.shiftKey)
        ? "redo"
        : null;
  if (which) {
    event.preventDefault();
    event.stopPropagation();
  }
  return which;
}
