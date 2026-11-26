import { lookImages, lookLabels } from "../../../docs/schema/menu/v1/imageButtonGeometry";
import type {
  ElementLabel,
  ImageButtonImage,
} from "../../../docs/schema/menu/v1/imageButtonGeometry";
import type { Appearance } from "./types";

/**
 * The components the editor knows, per open Project: what turns a menu's file of that Project
 * into the menu as it is drawn (`expandMenuComponents`, given by `lib/pack/components.ts`, the
 * pack builder's own reading). Fed by `useComponentsFeed`; the domain only reads it, so a look
 * that names a component is drawn on the canvas as the pack draws it.
 */
interface ProjectComponents {
  /** The Project's folder on the server: what its own images are named with in a component. */
  folder: string;
  expand: (menu: unknown) => unknown;
}

let byProject: ReadonlyMap<string, ProjectComponents> = new Map();
let version = 0;
const listeners = new Set<() => void>();

export function setComponents(next: ReadonlyMap<string, ProjectComponents>) {
  byProject = next;
  version++;
  for (const listener of listeners) listener();
}

export function subscribeComponents(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes each time the known components do: what a view that draws components re-reads on. */
export const componentsVersion = () => version;

/** A component's text as it is written: one text, or one per language. */
export type ComponentText = string | Record<string, string>;

/** What a look that names a component draws, or null: no component, or one the editor cannot read. */
export function componentLook(
  appearance: Appearance,
  projectId: string | undefined,
): {
  images: ImageButtonImage[];
  labels: (ElementLabel<ComponentText> & { valign?: string })[];
} | null {
  if (appearance.component === undefined || projectId === undefined) return null;
  const known = byProject.get(projectId);
  if (!known) return null;
  const look = { component: appearance.component };
  const menu = known.expand({ elements: [look] }) as { elements: unknown[] };
  const expanded = menu.elements[0];
  if (expanded === look) return null;
  const own = `${known.folder}:`;
  const images = (lookImages(expanded) as ImageButtonImage[]).map((image) =>
    image.asset.startsWith(own) ? { ...image, asset: image.asset.slice(own.length) } : image,
  );
  return {
    images,
    labels: lookLabels(expanded) as (ElementLabel<ComponentText> & { valign?: string })[],
  };
}
