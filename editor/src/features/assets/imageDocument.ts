import type { Asset } from "@/domain/asset";
import type { ComposeRecipe } from "@/lib/pack/compose";
import { type RgbaImage, decodePng, encodePng } from "@/lib/pack/png";
import { useRef, useState } from "react";
import { assetBytes } from "./assetBytes";
import { toDataUrl } from "./composedAssets";
import { copyImage, sameImage } from "./pixelTools";

/** The steps kept to undo. */
const HISTORY = 100;

export const sameRecipe = (a: ComposeRecipe, b: ComposeRecipe) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The pixels of one layer, as they are drawn in the atelier. */
export interface Drawing {
  /** The image drawn on: a file of the module, or one that is not written yet (`draft`). */
  asset: Asset;
  /** Changed in place, stroke after stroke. */
  image: RgbaImage;
  /** The pixels as they are saved. */
  saved: RgbaImage;
  /** The content these pixels were read from or written as; `null` for a draft. */
  hash: string | null;
  /** A layer drawn here that has no file yet: saving the image writes it. */
  draft: boolean;
  /** Counts the changes of `image`. */
  rev: number;
}

/** What one step back puts back: the layers, and the pixels a stroke changed. */
interface Step {
  recipe: ComposeRecipe;
  pixels: { id: string; image: RgbaImage }[];
}

/**
 * An image open in the atelier: its layers (`recipe`) and the pixels drawn on them, with one
 * history for both. A layer moved and a stroke drawn are steps of the same list, undone in the
 * order they were made, whatever layer or tool is in hand. Nothing here writes a file: the
 * atelier saves the pixels and the layers together.
 *
 * `setRecipe` records the layers it replaces, unless `gesture` names the same gesture as the
 * change before (a drag, a field typed in), which is then one step. `drew` records a stroke.
 */
export function useImageDocument(first: ComposeRecipe) {
  const [, setVersion] = useState(0);
  const bump = () => setVersion((n) => n + 1);
  const state = useRef<{ past: Step[]; now: ComposeRecipe; next: Step[] }>({
    past: [],
    now: first,
    next: [],
  });
  const last = useRef<string | null>(null);
  const drawings = useRef(new Map<string, Drawing>());
  const unreadable = useRef(new Set<string>());
  const reading = useRef(new Map<string, string>());
  const pictures = useRef(new Map<string, { rev: number; url: string }>());
  const changed = useRef(new Map<string, { rev: number; dirty: boolean }>());

  const s = state.current;
  const record = (step: Step) => {
    s.past = [...s.past.slice(1 - HISTORY), step];
    s.next = [];
  };
  /** Puts `step` back, and returns the step that undoes that. */
  const restore = (step: Step): Step => {
    const inverse: Step = { recipe: s.now, pixels: [] };
    s.now = step.recipe;
    for (const { id, image } of step.pixels) {
      const drawing = drawings.current.get(id);
      if (!drawing || drawing.image.data.length !== image.data.length) continue;
      inverse.pixels.push({ id, image: copyImage(drawing.image) });
      drawing.image.data.set(image.data);
      drawing.rev += 1;
    }
    return inverse;
  };
  const dirty = (id: string): boolean => {
    const drawing = drawings.current.get(id);
    if (!drawing) return false;
    const known = changed.current.get(id);
    if (known?.rev === drawing.rev) return known.dirty;
    const now = !sameImage(drawing.image, drawing.saved);
    changed.current.set(id, { rev: drawing.rev, dirty: now });
    return now;
  };

  return {
    recipe: s.now,
    canUndo: s.past.length > 0,
    canRedo: s.next.length > 0,
    setRecipe(
      change: ComposeRecipe | ((recipe: ComposeRecipe) => ComposeRecipe),
      gesture?: string,
    ) {
      const merged = gesture !== undefined && last.current === gesture;
      const now = typeof change === "function" ? change(s.now) : change;
      if (sameRecipe(now, s.now)) return;
      last.current = gesture ?? null;
      if (merged && s.past.length > 0) s.next = [];
      else record({ recipe: s.now, pixels: [] });
      s.now = now;
      bump();
    },
    undo() {
      last.current = null;
      const back = s.past.at(-1);
      if (!back) return;
      s.past = s.past.slice(0, -1);
      s.next = [restore(back), ...s.next];
      bump();
    },
    redo() {
      last.current = null;
      const [forth, ...next] = s.next;
      if (!forth) return;
      s.next = next;
      s.past = [...s.past, restore(forth)];
      bump();
    },
    /** Other layers under this image (saved, or changed elsewhere): start again from them. */
    reset(recipe: ComposeRecipe) {
      last.current = null;
      // The layers just saved are the ones in hand: what led to them can still be undone.
      if (sameRecipe(recipe, s.now)) return;
      s.past = [];
      s.next = [];
      s.now = recipe;
      bump();
    },
    /** Back to what is saved, layers and pixels, as one step. */
    discard(recipe: ComposeRecipe) {
      last.current = null;
      const step: Step = { recipe: s.now, pixels: [] };
      for (const [id, drawing] of drawings.current) {
        if (!dirty(id)) continue;
        step.pixels.push({ id, image: copyImage(drawing.image) });
        drawing.image.data.set(drawing.saved.data);
        drawing.rev += 1;
      }
      if (step.pixels.length === 0 && sameRecipe(recipe, s.now)) return;
      record(step);
      s.now = recipe;
      bump();
    },

    drawing: (id: string): Drawing | undefined => drawings.current.get(id),
    drawings: (): Drawing[] => [...drawings.current.values()],
    failed: (id: string): boolean => unreadable.current.has(id),
    dirty,
    /** Reads `asset`'s pixels to draw on them, unless they are in hand and still its file's. */
    read(asset: Asset) {
      const had = drawings.current.get(asset.id);
      if (had && (had.draft || had.hash === asset.contentHash || dirty(asset.id))) return;
      if (reading.current.get(asset.id) === asset.contentHash) return;
      reading.current.set(asset.id, asset.contentHash);
      unreadable.current.delete(asset.id);
      assetBytes(asset)
        .then((bytes) => {
          if (reading.current.get(asset.id) !== asset.contentHash) return;
          reading.current.delete(asset.id);
          const image = decodePng(bytes);
          drawings.current.set(asset.id, {
            asset,
            image,
            saved: copyImage(image),
            hash: asset.contentHash,
            draft: false,
            rev: (had?.rev ?? 0) + 1,
          });
          bump();
        })
        .catch(() => {
          if (reading.current.get(asset.id) !== asset.contentHash) return;
          reading.current.delete(asset.id);
          unreadable.current.add(asset.id);
          bump();
        });
    },
    /** A layer drawn here, empty: `asset` stands for the file saving will write. */
    addDraft(asset: Asset, image: RgbaImage) {
      drawings.current.set(asset.id, {
        asset,
        image,
        saved: copyImage(image),
        hash: null,
        draft: true,
        rev: 1,
      });
      bump();
    },
    /** The pixels of `id` changed under the pointer: what shows them is drawn again. */
    touched(id: string) {
      const drawing = drawings.current.get(id);
      if (drawing) drawing.rev += 1;
      bump();
    },
    /** A stroke on `id` is done: `before` is what it drew over, one step to undo. */
    drew(id: string, before: RgbaImage) {
      last.current = null;
      record({ recipe: s.now, pixels: [{ id, image: before }] });
      const drawing = drawings.current.get(id);
      if (drawing) drawing.rev += 1;
      bump();
    },
    /**
     * The pixels of `id` are written as `asset`: they are the saved ones. A draft, or an image
     * renamed by the save, goes on under the id of its file.
     */
    written(id: string, asset: Asset) {
      const drawing = drawings.current.get(id);
      if (!drawing) return;
      drawing.asset = asset;
      drawing.saved = copyImage(drawing.image);
      drawing.hash = asset.contentHash;
      drawing.draft = false;
      drawing.rev += 1;
      if (asset.id !== id) {
        drawings.current.delete(id);
        drawings.current.set(asset.id, drawing);
        const renamed = (step: Step): Step => ({
          ...step,
          pixels: step.pixels.map((p) => (p.id === id ? { ...p, id: asset.id } : p)),
        });
        s.past = s.past.map(renamed);
        s.next = s.next.map(renamed);
      }
      bump();
    },
    /** The image `id` as it is drawn now, a data URL; empty when its pixels are not in hand. */
    picture(id: string): string {
      const drawing = drawings.current.get(id);
      if (!drawing) return "";
      const known = pictures.current.get(id);
      if (known?.rev === drawing.rev) return known.url;
      const url = toDataUrl(encodePng(drawing.image));
      pictures.current.set(id, { rev: drawing.rev, url });
      return url;
    },
  };
}

export type ImageDocument = ReturnType<typeof useImageDocument>;
