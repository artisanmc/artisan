import { type KitTheme, readKitTheme } from "@/lib/pack/theme";
import { type KitRead, useKitStore } from "@/state/kitStore";

type Binary = (projectId: string, path: string) => Promise<Uint8Array | null>;

let last: { read: KitRead; name: string; theme: KitTheme | null } | undefined;

/**
 * The theme the server's pack is built in (`lib/pack/theme.ts`), as its kit module holds it
 * published: what the editor shows a `kit:<name>` image in, like the game. `null`: the server
 * names none, or one its kit does not hold. `binary` reads a published file of a module.
 */
export function activeKitTheme(binary: Binary): KitTheme | null {
  const { read, theme: name } = useKitStore.getState();
  if (!read || !name) return null;
  if (last?.read !== read || last.name !== name)
    last = {
      read,
      name,
      theme: readKitTheme(name, {
        files: Object.entries(read.files).map(([path, content]) => ({ path, content })),
        binaries: read.binaries,
        binary: (path) => binary(read.projectId, path).catch(() => null),
      }),
    };
  return last.theme;
}
