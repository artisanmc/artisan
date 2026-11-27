import { type Asset, type AssetUsage, assetPreviewUrl } from "@/domain/asset";
import { loadPersistedDrafts, usePersistedDraftStore } from "@/features/project/persistedDrafts";
import { readProjectFiles } from "@/lib/api/projectFiles";
import { deleteAsset, uploadAsset } from "@/lib/api/userAssets";
import { KIT_ASCENT, KIT_FOLDER, KIT_PREFIX } from "@/lib/pack/kit";
import { projectPrincipal } from "@/lib/projectPrincipal";
import { type KitRead, useKitStore } from "@/state/kitStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { assetBytes } from "./assetBytes";

/**
 * The server's library written from a module (ADR `themes-reach-modules`, decision 1): an
 * image added while building a menu goes to the library, the theme `artisan`'s Project, and not
 * to the menu's module. The library is another Project than the one open: its draft is opened
 * beside, with the published files as its base, and the image is written there like any image
 * of that Project. It reaches the server when that draft is deployed.
 */

/**
 * The library's Project for an image added in `projectId`: `null` in the library itself, in a
 * theme, and on a server that does not read a common image by its name alone (an older one,
 * where an added image stays in its module).
 */
export function libraryFor(
  projectId: string,
  kit: {
    read: KitRead | undefined;
    own: Readonly<Record<string, KitRead>>;
  } = useKitStore.getState(),
): string | null {
  const { read, own } = kit;
  if (!read?.byName || read.projectId === projectId) return null;
  if (Object.values(own).some((theme) => theme.projectId === projectId)) return null;
  return read.projectId;
}

/** `libraryFor` of the open Project, read again when the server's Projects are. */
export function useLibraryFor(projectId: string): string | null {
  const read = useKitStore((s) => s.read);
  const own = useKitStore((s) => s.own);
  return libraryFor(projectId, { read, own });
}

const opening = new Map<string, Promise<void>>();

/**
 * Makes the draft of the library `libraryId` writable from another Project: its published
 * files become its base when none is held yet, and the player's drafts of it are read. Done
 * once; a library already open in this tab keeps what it has.
 */
export function openLibraryDraft(libraryId: string): Promise<void> {
  const owner = projectPrincipal.current(libraryId)?.id;
  if (!owner) return Promise.reject(new Error("draft_unavailable"));
  if (usePersistedDraftStore.getState().sessions[libraryId]?.ownerId === owner)
    return Promise.resolve();
  const key = `${owner}\n${libraryId}`;
  let work = opening.get(key);
  if (!work) {
    work = (async () => {
      const baselines = useProjectBaselineStore.getState();
      if (!baselines.get(libraryId)) {
        const read = await readProjectFiles(libraryId);
        if (!read.ok || read.unchanged) throw new Error("draft_unavailable");
        baselines.set(libraryId, read.files);
        baselines.setBinaries(
          libraryId,
          Object.fromEntries(
            (read.binaries ?? []).map(({ path, hash, size }) => [path, { hash, size }]),
          ),
        );
      }
      await loadPersistedDrafts(libraryId, owner);
      if (usePersistedDraftStore.getState().sessions[libraryId]?.ownerId !== owner)
        throw new Error("draft_unavailable");
    })().finally(() => opening.delete(key));
    opening.set(key, work);
  }
  return work;
}

/**
 * Writes an image into the draft of the library `libraryId`. A name the library already has is
 * refused (409), as in any Project: nothing of the server's is replaced from a menu.
 */
export async function addToLibrary(
  libraryId: string,
  input: { file: File; name: string; usages?: AssetUsage[] },
): Promise<Asset> {
  await openLibraryDraft(libraryId);
  return uploadAsset(libraryId, { ...input, type: "glyph" });
}

const MOVED_USAGES: readonly string[] = ["button", "menu"];

/**
 * Whether the image `asset` of a module can be moved to the library: one added on this server
 * (`shipped` false: a module holds what it shipped with), a plain PNG whose descriptor says
 * nothing a library image does not keep (no slices, no recipe).
 */
export function movableToLibrary(asset: Asset, shipped: boolean): boolean {
  return (
    !shipped &&
    asset.type !== "font" &&
    !asset.under &&
    !asset.compose &&
    !asset.slice &&
    !asset.draftId
  );
}

/**
 * Moves the image `asset` of the module `projectId` to the library `libraryId`, under the name
 * the menus write (its id): they keep naming it and now read the library's. The copy is written
 * first: if the module's image cannot be deleted, it stays and still wins over the copy.
 */
export async function moveToLibrary(
  libraryId: string,
  projectId: string,
  asset: Asset,
): Promise<void> {
  const png = await assetBytes(asset);
  await addToLibrary(libraryId, {
    file: new File([png as BlobPart], `${asset.id}.png`, { type: "image/png" }),
    name: asset.id,
    usages: (asset.usages ?? []).filter((u): u is AssetUsage => MOVED_USAGES.includes(u)),
  });
  await deleteAsset(projectId, asset.id);
}

/** An image of the library's draft as the common image a menu names: `kit:<name>`. */
export function libraryImage(asset: Asset): Asset {
  const id = KIT_PREFIX + asset.name;
  return {
    ...asset,
    id,
    name: id,
    projectId: KIT_FOLDER,
    type: "texture",
    ascent: KIT_ASCENT,
    codepoint: null,
    previewUrl: assetPreviewUrl(asset),
  };
}
