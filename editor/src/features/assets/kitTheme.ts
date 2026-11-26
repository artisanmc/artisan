import {
  type KitTheme,
  type ThemeFiles,
  type ThemeLook,
  readKitTheme,
  readKitThemes,
  readOwnTheme,
  themeNames,
} from "@/lib/pack/theme";
import { type KitRead, useKitStore } from "@/state/kitStore";

type Binary = (projectId: string, path: string) => Promise<Uint8Array | null>;
type Own = Readonly<Record<string, KitRead>>;

const filesOf = (read: KitRead, binary: Binary): ThemeFiles => ({
  files: Object.entries(read.files).map(([path, content]) => ({ path, content })),
  binaries: read.binaries,
  binary: (path) => binary(read.projectId, path).catch(() => null),
});

/**
 * The names of a server's themes: the ones of their own folder (`own`), and the ones its common
 * images' Project `read` still keeps.
 */
export function serverThemeNames(read: KitRead | undefined, own: Own): string[] {
  const kept = read ? themeNames(read.binaries.map((b) => b.path)) : [];
  return [...new Set([...Object.keys(own), ...kept])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The theme `name` of a server, as published: the Project of that name, else the folder the common images keep. `null`: it holds none. */
export function serverTheme(
  read: KitRead | undefined,
  own: Own,
  name: string,
  binary: Binary,
): KitTheme | null {
  const mine = own[name];
  if (mine) return readOwnTheme(filesOf(mine, binary));
  return read ? readKitTheme(name, filesOf(read, binary)) : null;
}

let last:
  | { read: KitRead | undefined; own: Own; names: readonly string[]; look: ThemeLook | null }
  | undefined;

/**
 * The themes in place on the server (`lib/pack/theme.ts`), as it holds them published: what the
 * editor shows a `kit:<name>` image in, like the game. `null`: the server names none, or none it
 * holds. `binary` reads a published file of a Project.
 */
export function activeKitTheme(binary: Binary): ThemeLook | null {
  const { read, own, themes: names } = useKitStore.getState();
  if (names.length === 0 || (!read && Object.keys(own).length === 0)) return null;
  if (!last || last.read !== read || last.own !== own || last.names !== names)
    last = {
      read,
      own,
      names,
      look: readKitThemes(
        names,
        read && filesOf(read, binary),
        new Map(Object.entries(own).map(([name, theme]) => [name, filesOf(theme, binary)])),
      ),
    };
  return last.look;
}
