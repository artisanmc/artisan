import { slotXY, TEX_SLOT_INNER, TEX_SLOT_INNER_OFFSET } from "@/features/canvas/menuLayout";
import { useHoverStore } from "@/state/hoverStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import Konva from "konva";
import { useLayoutEffect, useState } from "react";
import { useCurrentFrame } from "remotion";
import type { Point } from "./anim";

/**
 * Applique l'état de l'image courante aux stores de l'éditeur avant la capture.
 * `apply` doit poser un état complet (jamais un incrément) : Remotion rend les
 * images dans le désordre, sur plusieurs onglets.
 */
export function useDrive(apply: (frame: number) => void, deps: unknown[] = []) {
  const frame = useCurrentFrame();
  // biome-ignore lint/correctness/useExhaustiveDependencies: l'image et `deps` suffisent
  useLayoutEffect(() => apply(frame), [frame, ...deps]);
  return frame;
}

/**
 * Position d'écran calculée après la mise en page (cases du canvas, nœuds du
 * DOM), recalculée à chaque image : elle dépend de la caméra.
 */
export function useMeasure<T>(measure: () => T | null): T | null {
  const frame = useCurrentFrame();
  const [value, setValue] = useState<{ frame: number; value: T | null }>({ frame: -1, value: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: l'image suffit
  useLayoutEffect(() => {
    const next = measure();
    if (value.frame !== frame || JSON.stringify(next) !== JSON.stringify(value.value)) setValue({ frame, value: next });
  });
  return value.value;
}

export type Camera = { x: number; y: number; scale: number };

// Une seule scène de canvas est montée à la fois (Promo enchaîne les scènes
// sans chevauchement) : le Stage de l'éditeur est le dernier créé.
function stage(): Konva.Stage | undefined {
  return Konva.stages[Konva.stages.length - 1];
}

/**
 * Cadre la caméra du canvas. Le Stage garde son pan/zoom en état interne : on
 * le pilote directement côté Konva, comme le fait la molette de l'éditeur.
 */
let lastCamera: Camera | null = null;

export function setCamera(camera: Camera) {
  lastCamera = camera;
  const s = stage();
  if (!s) return;
  s.position({ x: camera.x, y: camera.y });
  s.scale({ x: camera.scale, y: camera.scale });
  s.draw();
}

/** Centre d'une case de menu, en pixels de la composition. */
export function slotCenter(menuId: string, slot: number, rows: number): Point | null {
  const s = stage();
  const group = s?.findOne(`.menu:${menuId}`);
  if (!s || !group) return null;
  const local = slotXY(slot, "chest", rows);
  const half = TEX_SLOT_INNER_OFFSET + TEX_SLOT_INNER / 2;
  const abs = group.getAbsoluteTransform().point({ x: local.x + half, y: local.y + half });
  const box = s.container().getBoundingClientRect();
  return { x: box.left + abs.x, y: box.top + abs.y };
}

/** Centre d'un nœud du DOM, en pixels de la composition. */
export function domCenter(selector: string): Point | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export type Box = { x: number; y: number; width: number; height: number };

/** Caméra qui centre `box` (coordonnées du monde) dans un Stage de `view`, avec `zoom`. */
export function cameraOn(box: Box, view: { width: number; height: number }, zoom: number): Camera {
  return {
    scale: zoom,
    x: view.width / 2 - (box.x + box.width / 2) * zoom,
    y: view.height / 2 - (box.y + box.height / 2) * zoom,
  };
}

/** Interpolation linéaire entre deux caméras (l'adoucissement vient de `t`). */
export function mixCamera(a: Camera, b: Camera, t: number): Camera {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, scale: a.scale + (b.scale - a.scale) * t };
}

/**
 * Sélection de l'éditeur, posée seulement si elle change : une nouvelle
 * sélection relance les effets du canvas (fermeture de l'infobulle…).
 */
export function select(ids: string[], slot: number | null = null, menuId: string | null = null) {
  const s = useSelectionStore.getState();
  const same =
    s.ids.size === ids.length && ids.every((id) => s.ids.has(id)) && s.focusedSlot === slot && s.menuId === menuId;
  if (!same) s.set(ids, slot, menuId);
}

/** Infobulle de l'éditeur sur une case, ou aucune (`null`). */
export function hover(target: { elementId: string; menuId: string; slot: number; at: Point } | null) {
  const s = useHoverStore.getState();
  const next = target
    ? { elementId: target.elementId, menuId: target.menuId, slotPosition: target.slot, x: target.at.x, y: target.at.y }
    : { elementId: null, menuId: null, slotPosition: null, x: 0, y: 0 };
  if (
    s.elementId !== next.elementId ||
    s.menuId !== next.menuId ||
    s.slotPosition !== next.slotPosition ||
    s.x !== next.x ||
    s.y !== next.y
  )
    useHoverStore.setState(next as never);
}

/** Réapplique la dernière caméra : un rendu du Stage a pu la remplacer depuis. */
export function reapplyCamera() {
  if (lastCamera) setCamera(lastCamera);
}

/** Cadrage initial du Stage, lu une seule fois à son montage. */
export function primeCamera(projectId: string, camera: Camera) {
  lastCamera = camera;
  useUiStore.setState((s) => ({ canvasViewports: { ...s.canvasViewports, [projectId]: camera } }));
}
