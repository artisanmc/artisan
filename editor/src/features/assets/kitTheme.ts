import { type ThemeLook, readKitThemes } from "@/lib/pack/theme";
import { type KitRead, useKitStore } from "@/state/kitStore";

type Binary = (projectId: string, path: string) => Promise<Uint8Array | null>;

let last: { read: KitRead; names: readonly string[]; look: ThemeLook | null } | undefined;

/**
 * The themes in place on the server (`lib/pack/theme.ts`), as its kit module holds them
 * published: what the editor shows a `kit:<name>` image in, like the game. `null`: the server
 * names none, or none its kit holds. `binary` reads a published file of a module.
 */
export function activeKitTheme(binary: Binary): ThemeLook | null {
  const { read, themes: names } = useKitStore.getState();
  if (!read || names.length === 0) return null;
  if (last?.read !== read || last.names !== names)
    last = {
      read,
      names,
      look: readKitThemes(names, {
        files: Object.entries(read.files).map(([path, content]) => ({ path, content })),
        binaries: read.binaries,
        binary: (path) => binary(read.projectId, path).catch(() => null),
      }),
    };
  return last.look;
}
