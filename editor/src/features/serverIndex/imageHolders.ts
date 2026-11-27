import { type ElsewhereWhere, commonHolders, themeOwnNames } from "@/lib/pack/elsewhere";
import { assetNamesIn } from "@/lib/pack/kit";
import { useKitStore } from "@/state/kitStore";
import { draftedLibrary } from "@/state/libraryRead";
import { useServerIndexStore } from "./serverIndexStore";

const pathsOf = (held: { files: Record<string, string>; binaries: { path: string }[] }) => [
  ...held.binaries.map((b) => b.path),
  ...Object.keys(held.files),
];

/**
 * Who holds which image on the server, for the names a module being edited writes
 * (`reachOf`): the module's own images as its draft holds them (`draft`: the paths of its
 * files; without `binaries`, its images are the published ones), the base, the server's common
 * images, the other modules and the themes' own images, all as published, in the pack's
 * order. `null` on a server
 * whose common images are not the theme `artisan` (an older one, or one not read yet): a name
 * alone is not read by this rule there.
 */
export function imageHolders(
  edited: { id: string; diskId?: string },
  draft: { files: Iterable<string>; binaries?: Iterable<string> },
): ElsewhereWhere | null {
  const { reads } = useServerIndexStore.getState();
  // The library as the player's draft of it has it: an image added from a menu is common.
  const kit = draftedLibrary(useKitStore.getState().read);
  if (!kit?.byName) return null;
  const published = reads.find((r) => r.summary.id === edited.id);
  const own = new Set(
    assetNamesIn([
      ...draft.files,
      ...(draft.binaries ?? published?.binaries.map((b) => b.path) ?? []),
    ]),
  );

  const modules = reads
    .filter((r) => !r.summary.role && r.summary.id !== edited.id && r.summary.id !== kit.projectId)
    .sort((a, b) => (a.summary.id < b.summary.id ? -1 : a.summary.id > b.summary.id ? 1 : 0))
    .map((r) => {
      const held = new Set(assetNamesIn(pathsOf(r)));
      return {
        folder: r.summary.externalId ?? r.summary.id,
        own: (name: string) => held.has(name),
      };
    });
  const themes = reads
    .filter((r) => r.summary.role === "theme" && r.summary.id !== kit.projectId)
    .map((r) => {
      const held = themeOwnNames({
        files: Object.entries(r.files).map(([path, content]) => ({ path, content })),
        binaries: r.binaries.map((b) => ({ ...b, size: 0 })),
      });
      return {
        folder: r.summary.externalId ?? r.summary.id,
        own: (name: string) => held.has(name),
      };
    });
  return {
    folder: edited.diskId ?? edited.id,
    own: (name) => own.has(name),
    ...commonHolders(pathsOf(kit)),
    modules,
    themes,
  };
}
