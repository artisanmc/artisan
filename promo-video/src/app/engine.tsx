import { useSelectionStore } from "@/state/selectionStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { useUiStore } from "@/state/uiStore";
import { EditorView } from "@codemirror/view";
import Konva from "konva";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { continueRender, delayRender, useCurrentFrame } from "remotion";
import { type Point, tween } from "../kit/anim";
import { H, W } from "../size";
import { network, router } from "./boot";

export { H, W };

/** Où le curseur va : un élément de l'interface, ou un point de l'écran de l'éditeur. */
export type Target = (() => Element | Point | null | undefined) | Point;

export type Entry =
  /** Le curseur arrive sur la cible à l'image `at`. */
  | { at: number; move: Target; dx?: number; dy?: number }
  /** Clic à la position du curseur (sur la cible du dernier `move`). */
  | { at: number; click: true }
  /** Survol à la position du curseur (infobulle du canvas). */
  | { at: number; hover: true }
  | { at: number; run: (h: Helpers) => void | Promise<void> };

/** Cadrage de la vidéo sur l'éditeur : centre visé et grossissement. */
export type Shot = { cx: number; cy: number; zoom: number };
export const WIDE: Shot = { cx: W / 2, cy: H / 2, zoom: 1 };

export interface Scene {
  id: string;
  /** Adresse de l'éditeur ouverte à l'entrée de la scène. */
  url: string;
  timeline: Entry[];
  camera?: [number, Shot][];
}

export interface Helpers {
  wait: (ms: number) => Promise<void>;
  until: (test: () => unknown, label?: string, timeout?: number) => Promise<void>;
  settle: () => Promise<void>;
  goto: (url: string) => Promise<void>;
  click: (el: Element | null | undefined) => void;
  type: (el: Element | null | undefined, value: string) => void;
  key: (key: string) => void;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frames = (n = 2) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

async function until(test: () => unknown, label = "condition", timeout = 15000) {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > timeout) throw new Error(`Attente dépassée : ${label}`);
    await wait(30);
  }
}

/** L'éditeur a fini de lire le hub et de se redessiner. */
async function settle() {
  await frames(2);
  await until(() => network.idleFor() > 120, "réseau au repos", 20000);
  await document.fonts.ready;
  await frames(2);
}

function pointerAt(el: Element, type: string, at: Point, extra: MouseEventInit = {}) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, button: 0, ...extra };
  const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
  el.dispatchEvent(new Ctor(type, { ...init, ...(type.startsWith("pointer") ? { pointerId: 1, pointerType: "mouse", isPrimary: true } : {}) } as never));
}

const centerOf = (el: Element): Point => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

function clickElement(el: Element | null | undefined, at?: Point) {
  if (!el) throw new Error("Clic sur un élément absent");
  const p = at ?? centerOf(el);
  pointerAt(el, "pointerdown", p, { buttons: 1 });
  pointerAt(el, "mousedown", p, { buttons: 1 });
  if (el instanceof HTMLElement) el.focus?.();
  pointerAt(el, "pointerup", p);
  pointerAt(el, "mouseup", p);
  pointerAt(el, "click", p);
}

function typeInto(el: Element | null | undefined, value: string) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error("Saisie hors d'un champ");
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const helpers: Helpers = {
  wait,
  until,
  settle,
  goto: async (url) => {
    await router.navigate({ to: url as never });
    await settle();
  },
  click: (el) => clickElement(el),
  type: typeInto,
  key: (key) => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  },
};

/**
 * Remet l'éditeur dans l'état d'une première visite : chaque onglet du rendu entre dans une scène
 * sans avoir forcément joué les précédentes, et doit y trouver la même chose.
 */
async function resetEditor() {
  helpers.key("Escape");
  await frames(2);
  helpers.key("Escape");
  useSelectionStore.getState().clear();
  useSidebarStore.getState().close();
  useUiStore.getState().setMinimapVisible(false);
  await router.navigate({ to: "/settings" as never });
  await frames(3);
}

/** Ce que l'onglet a déjà joué : les images arrivent dans l'ordre, les étapes ne sont jamais rejouées. */
const played = { scene: "", next: 0, points: [] as (Point | null)[], targets: [] as (Element | null)[], cursor: null as Point | null };
let queue: Promise<void> = Promise.resolve();

function resolveMove(entry: Extract<Entry, { move: Target }>, i: number): boolean {
  if (played.points[i]) return true;
  if (typeof entry.move !== "function") {
    played.points[i] = { x: entry.move.x + (entry.dx ?? 0), y: entry.move.y + (entry.dy ?? 0) };
    played.targets[i] = null;
    return true;
  }
  const found = entry.move();
  if (!found) return false;
  const c = found instanceof Element ? centerOf(found) : found;
  played.points[i] = { x: c.x + (entry.dx ?? 0), y: c.y + (entry.dy ?? 0) };
  played.targets[i] = found instanceof Element ? found : null;
  return true;
}

/** L'élément sous un point de l'éditeur : le canvas pour la planche, sinon l'élément du DOM. */
function elementAt(p: Point): Element | null {
  return document.elementFromPoint(p.x, p.y);
}

async function advance(scene: Scene, frame: number) {
  if (played.scene !== scene.id) {
    played.scene = scene.id;
    network.scene = scene.id;
    played.next = 0;
    played.points = [];
    played.targets = [];
    played.cursor = null;
    await resetEditor();
    await helpers.goto(scene.url);
    await wait(500);
    await settle();
    // L'ouverture d'un module déplie la navigation : la vidéo montre l'espace de travail seul.
    useSidebarStore.getState().close();
    useSelectionStore.getState().clear();
    await frames(3);
  }
  const lookahead = () => {
    // Les cibles des prochains déplacements se mesurent dès que l'étape précédente est jouée.
    for (let i = played.next; i < scene.timeline.length; i++) {
      const e = scene.timeline[i]!;
      if (!("move" in e)) break;
      if (!resolveMove(e, i)) break;
    }
  };
  lookahead();
  while (played.next < scene.timeline.length && scene.timeline[played.next]!.at <= frame) {
    const i = played.next;
    const entry = scene.timeline[i]!;
    if ("move" in entry) {
      // Une cible absente laisse le curseur où il est : le rendu continue et le journal le dit.
      if (!resolveMove(entry, i)) console.error(`${scene.id} : cible du déplacement ${i} (image ${entry.at}) introuvable`);
      else played.cursor = played.points[i]!;
    } else if ("click" in entry) {
      const p = played.cursor;
      if (!p) throw new Error(`${scene.id} : clic sans curseur`);
      // L'élément visé est repris à l'instant du clic : il a pu bouger de quelques pixels depuis la mesure.
      const aimed = [...scene.timeline.slice(0, i)].reverse().find((e) => "move" in e) as
        | Extract<Entry, { move: Target }>
        | undefined;
      const now = aimed && typeof aimed.move === "function" ? aimed.move() : null;
      if (now instanceof Element) clickElement(now);
      else {
        const at = now ? { x: now.x + (aimed?.dx ?? 0), y: now.y + (aimed?.dy ?? 0) } : p;
        clickElement(elementAt(at), at);
      }
      await settle();
    } else if ("hover" in entry) {
      const p = played.cursor;
      const el = p && elementAt(p);
      if (p && el) {
        pointerAt(el, "pointermove", p);
        pointerAt(el, "mousemove", p);
        pointerAt(el, "mouseover", p);
      }
      await frames(3);
    } else {
      await entry.run(helpers);
      await settle();
    }
    played.next = i + 1;
    lookahead();
  }
}

/** Position du curseur à l'image `frame` : il glisse d'une cible à la suivante. */
function cursorAt(scene: Scene, frame: number): { at: Point; clicks: number[] } | null {
  const keys: [number, Point][] = [];
  scene.timeline.forEach((e, i) => {
    if ("move" in e && played.points[i]) keys.push([e.at, played.points[i]!]);
  });
  if (keys.length === 0) return null;
  const clicks = scene.timeline.filter((e) => "click" in e).map((e) => e.at);
  let prev = keys[0]!;
  let at = prev[1];
  for (const k of keys.slice(1)) {
    if (frame >= k[0]) {
      prev = k;
      at = k[1];
      continue;
    }
    // Le déplacement occupe les 22 dernières images avant l'arrivée.
    const start = Math.max(prev[0], k[0] - 22);
    at = { x: tween(frame, [start, k[0]], [prev[1].x, k[1].x]), y: tween(frame, [start, k[0]], [prev[1].y, k[1].y]) };
    break;
  }
  return { at, clicks };
}

export function shotAt(camera: [number, Shot][] | undefined, frame: number): Shot {
  if (!camera || camera.length === 0) return WIDE;
  let prev = camera[0]!;
  if (frame <= prev[0]) return prev[1];
  for (const k of camera.slice(1)) {
    if (frame <= k[0]) {
      const span: [number, number] = [prev[0], k[0]];
      return {
        cx: tween(frame, span, [prev[1].cx, k[1].cx]),
        cy: tween(frame, span, [prev[1].cy, k[1].cy]),
        zoom: tween(frame, span, [prev[1].zoom, k[1].zoom]),
      };
    }
    prev = k;
  }
  return prev[1];
}

/** Translation et échelle qui cadrent l'éditeur, sans jamais montrer hors de l'écran. */
export function frameOf(shot: Shot) {
  const z = shot.zoom;
  const x = Math.min(0, Math.max(W - W * z, W / 2 - shot.cx * z));
  const y = Math.min(0, Math.max(H - H * z, H / 2 - shot.cy * z));
  return { x, y, z };
}

function applyShot(shot: Shot | null) {
  const body = document.body;
  if (!shot || shot.zoom === 1) {
    body.style.transform = "";
    return;
  }
  const { x, y, z } = frameOf(shot);
  body.style.transformOrigin = "0 0";
  body.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
}

let overlayRoot: HTMLElement | null = null;
/** Calque hors de `body` : la caméra agrandit l'éditeur, pas les titres ni le curseur. */
export function overlay(): HTMLElement {
  if (!overlayRoot) {
    overlayRoot = document.createElement("div");
    overlayRoot.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:2147483647;overflow:hidden;`;
    document.documentElement.appendChild(overlayRoot);
  }
  return overlayRoot;
}

export function Overlay({ children }: { children: ReactNode }) {
  return createPortal(children, overlay());
}

/**
 * Joue la scène jusqu'à l'image courante, puis cadre. Rend la position du curseur à l'écran
 * (cadrage compris), ou null tant que la scène n'en a pas.
 */
export function useScene(scene: Scene): { cursor: Point | null; clicks: number[]; frame: number } {
  const frame = useCurrentFrame();
  const [, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: une passe par image
  useLayoutEffect(() => {
    const handle = delayRender(`${scene.id} image ${frame}`, { timeoutInMilliseconds: 120000 });
    let cancelled = false;
    queue = queue
      .then(async () => {
        if (cancelled) return;
        applyShot(null);
        await advance(scene, frame);
        applyShot(shotAt(scene.camera, frame));
        setTick((t) => t + 1);
        await frames(2);
        await until(() => network.idleFor() > 40, "images chargées", 20000);
        for (const stage of Konva.stages) stage.draw();
        await frames(1);
      })
      .catch((e) => {
        console.error(String(e));
        throw e;
      })
      .finally(() => continueRender(handle));
    return () => {
      cancelled = true;
    };
  }, [frame, scene]);
  const c = played.scene === scene.id ? cursorAt(scene, frame) : null;
  if (!c) return { cursor: null, clicks: [], frame };
  const { x, y, z } = frameOf(shotAt(scene.camera, frame));
  return { cursor: { x: c.at.x * z + x, y: c.at.y * z + y }, clicks: c.clicks, frame };
}

/** Quitte l'éditeur : plus aucun cadrage (écrans de titre). */
export function useNoShot() {
  const frame = useCurrentFrame();
  // biome-ignore lint/correctness/useExhaustiveDependencies: une passe par image
  useLayoutEffect(() => {
    queue = queue.then(() => applyShot(null));
  }, [frame]);
}

// Cibles usuelles.
const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const ownText = (el: Element) =>
  [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
function withText(test: (own: string) => boolean, within: string, nth: number): Element | null {
  const root = document.querySelector(within);
  if (!root) return null;
  const found: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n as Element;
    if (test(ownText(el)) && visible(el)) found.push(el);
  }
  return found[nth] ?? null;
}
/** L'élément dont le texte propre (hors enfants) est `label`, à la casse près (les libellés en capitales le sont par CSS). */
export const text =
  (label: string, within = "body", nth = 0): (() => Element | null) =>
  () =>
    withText((own) => own.toLowerCase() === label.toLowerCase(), within, nth);
/** L'élément dont le texte propre contient `part`. */
export const textHas =
  (part: string, within = "body", nth = 0): (() => Element | null) =>
  () =>
    withText((own) => own.includes(part), within, nth);
export const sel =
  (css: string, nth = 0): (() => Element | null) =>
  () =>
    [...document.querySelectorAll(css)].filter(visible)[nth] ?? null;
export const button = (name: string) => sel(`button[aria-label="${name}"], button[title="${name}"]`);

/** Un nœud de la planche (`menu:hub`, `slot:shop:10`, `command:cmd_shop`, `trigger:welcome`…). */
export const node =
  (name: string): (() => Point | null) =>
  () => {
    // La planche est la plus grande scène Konva : la minimap et les vignettes portent les mêmes noms.
    const area = (stage: Konva.Stage) => stage.width() * stage.height();
    for (const stage of [...Konva.stages].sort((a, b) => area(b) - area(a))) {
      const found = stage.findOne(`.${name}`);
      if (!found) continue;
      const box = found.getClientRect();
      const origin = stage.container().getBoundingClientRect();
      return { x: origin.left + box.x + box.width / 2, y: origin.top + box.y + box.height / 2 };
    }
    return null;
  };

/** Saisie lettre par lettre dans le champ `field`, à partir de l'image `at`. */
export function typing(at: number, field: () => Element | null, value: string, every = 4): Entry[] {
  return [...value].map((_, i) => ({
    at: at + i * every,
    run: (h: Helpers) => h.type(field(), value.slice(0, i + 1)),
  }));
}

/** Même saisie dans un éditeur de texte riche (CodeMirror) : `field` est son `.cm-editor`. */
export function typingRich(at: number, field: () => Element | null, value: string, every = 4): Entry[] {
  return [...value].map((_, i) => ({
    at: at + i * every,
    run: () => {
      const el = field();
      const view = el instanceof HTMLElement ? EditorView.findFromDOM(el) : null;
      if (!view) throw new Error(`Saisie hors d'un éditeur de texte : ${el ? el.outerHTML.slice(0, 300) : "aucun élément"}`);
      const typed = value.slice(0, i + 1);
      view.focus();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: typed }, selection: { anchor: typed.length } });
    },
  }));
}
