import { type ImageUse, KIT_FOLDER, commonImageKey, kitSlot } from "@/lib/pack/kit";
import { isThemeName } from "@/lib/pack/theme";
import type { KitRead, ModuleRead } from "@/state/kitStore";

/** A place an image can be saved in (`SaveAsDialog`): a theme of the server, its own theme, a module. */
export interface SaveAsPlace {
  kind: "theme" | "server" | "module";
  projectId: string;
  /** A theme's name or a module's folder; empty for the server's theme, which the dialog names. */
  name: string;
  /** A theme: whether the server's pack is built in it. The server's theme always is. */
  inPlace: boolean;
  /** The image names the place holds, as published. */
  holds: ReadonlySet<string>;
}

const IMAGE = /^assets\/(?:glyphs|textures)\/([^/]+)\.(?:png|ya?ml)$/;

function heldNames(read: KitRead): Set<string> {
  const names = new Set<string>();
  for (const path of [...read.binaries.map((b) => b.path), ...Object.keys(read.files)]) {
    const name = IMAGE.exec(path)?.[1];
    if (name) names.add(name);
  }
  return names;
}

/**
 * The places of a server in the order they are looked in (ADR `resources-one-screen`, decision
 * 2): its themes in place from the highest, its own theme, the themes put away, then its modules.
 */
export function saveAsPlaces(kit: {
  read: KitRead | undefined;
  own: Readonly<Record<string, KitRead>>;
  modules: readonly ModuleRead[];
  themes: readonly string[];
}): SaveAsPlace[] {
  const theme = (name: string): SaveAsPlace[] => {
    const read = kit.own[name];
    return read
      ? [
          {
            kind: "theme",
            projectId: read.projectId,
            name,
            inPlace: kit.themes.includes(name),
            holds: heldNames(read),
          },
        ]
      : [];
  };
  const away = Object.keys(kit.own)
    .filter((name) => !kit.themes.includes(name))
    .sort();
  return [
    ...[...kit.themes].reverse().flatMap(theme),
    ...(kit.read
      ? [
          {
            kind: "server" as const,
            projectId: kit.read.projectId,
            name: "",
            inPlace: true,
            holds: heldNames(kit.read),
          },
        ]
      : []),
    ...away.flatMap(theme),
    ...kit.modules.map((module) => ({
      kind: "module" as const,
      projectId: module.projectId,
      name: module.folder,
      inPlace: true,
      holds: heldNames(module),
    })),
  ];
}

const MODULE_NAME = /^[a-z0-9_-]+$/;

/** Why `name` cannot be an image's in a place of `kind`; `null` when it can. */
export function saveAsNameProblem(
  name: string,
  kind: SaveAsPlace["kind"] | "new",
): "invalid_name" | "base_name_in_module" | null {
  if (MODULE_NAME.test(name)) return null;
  if (!kitSlot(name)) return "invalid_name";
  // A name of the base holds a dot: only a theme may hold an image under it.
  return kind === "module" ? "base_name_in_module" : null;
}

/** Why `name` cannot be a new theme's; `null` when it can. */
export function newThemeProblem(
  name: string,
  taken: readonly string[],
): "invalid_name" | "project_exists" | null {
  if (!isThemeName(name) || name === KIT_FOLDER) return "invalid_name";
  return taken.includes(name) ? "project_exists" : null;
}

/** What saving an image under `name` in a place changes for the server's menus. */
export interface SaveAsEffect {
  /**
   * `replaces`: menus that showed the common image of that name show this one. `added`: no menu
   * names it yet.
   */
  kind: "replaces" | "added";
  menus: number;
  modules: number;
  /** The place is a theme put away: nothing changes until it is put in place. */
  away: boolean;
  /** The place has an image of that name, as published: this one takes its place. */
  overwrites: boolean;
}

/**
 * [SaveAsEffect] of the image `name` saved in `place` (`null`: a theme about to be created),
 * given what names each image on the server (`uses`, `useImageUses`). In a theme, the menus of
 * every module that write the common image `name` take it; in a module, that module's alone.
 */
export function saveAsEffect(
  name: string,
  place: SaveAsPlace | null,
  uses: ReadonlyMap<string, readonly ImageUse[]>,
): SaveAsEffect {
  const naming = (uses.get(commonImageKey(name)) ?? []).filter(
    (use) => !use.by && (place?.kind !== "module" || use.projectId === place.projectId),
  );
  return {
    kind: naming.length > 0 ? "replaces" : "added",
    menus: naming.length,
    modules: new Set(naming.map((use) => use.projectId)).size,
    away: place ? !place.inPlace : true,
    overwrites: !!place?.holds.has(name),
  };
}
