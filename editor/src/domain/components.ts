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
  /** The components a look of this Project may name, its own first, by the name it writes. */
  list: readonly KnownComponent[];
}

/** A component a look may name: the name to write and the parameters its file declares. */
export interface KnownComponent {
  name: string;
  /** Whether it is one of the server's common ones (the theme `artisan`). */
  common: boolean;
  params: readonly {
    name: string;
    type: "text" | "image" | "choice";
    default?: unknown;
    /** The names a `choice` offers, in the file's order. */
    values?: readonly string[];
  }[];
}

/** The names a `choice` parameter offers: its `values`, a list of names or a map by name. */
export function choiceNames(values: unknown): string[] {
  if (Array.isArray(values)) return values.filter((v): v is string => typeof v === "string");
  return values && typeof values === "object" ? Object.keys(values) : [];
}

/** The parameters a component's file declares (`params`), in the file's order. */
export function componentParams(file: unknown): KnownComponent["params"] {
  const params = (file as { params?: unknown } | null)?.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return [];
  return Object.entries(params as Record<string, unknown>).map(([name, raw]) => {
    const spec = (raw ?? {}) as { type?: unknown; default?: unknown; values?: unknown };
    if (spec.type === "choice")
      return {
        name,
        type: "choice" as const,
        values: choiceNames(spec.values),
        ...(spec.default !== undefined ? { default: spec.default } : {}),
      };
    return {
      name,
      type: spec.type === "image" ? ("image" as const) : ("text" as const),
      ...(spec.default !== undefined ? { default: spec.default } : {}),
    };
  });
}

/** The components a look of the Project may name; none while they are not known. */
export const knownComponents = (projectId: string | undefined): readonly KnownComponent[] =>
  (projectId !== undefined ? byProject.get(projectId)?.list : undefined) ?? [];

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
