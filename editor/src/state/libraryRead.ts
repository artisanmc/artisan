import { type KitRead, useKitStore } from "@/state/kitStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

/** What is read of a draft of the library. */
interface LibraryDraft {
  tree: Record<string, string>;
  binaryTree?: Record<string, { hash: string }>;
  remote?: { revision: number };
}

const drafted = new WeakMap<KitRead, { draft: unknown; library: KitRead }>();

/**
 * The library `read` as the player's draft of it holds it: the published files, with what the
 * draft adds, redraws and removes. A menu that names an image added a moment ago reaches it
 * (`reachOf`) before the draft is deployed. `read` itself without a draft on the hub.
 */
export function draftedLibrary(
  read: KitRead | undefined,
  draft: LibraryDraft | undefined = read && useProjectDraftStore.getState().get(read.projectId),
): KitRead | undefined {
  if (!read || !draft?.remote?.revision || !draft.binaryTree) return read;
  const known = drafted.get(read);
  if (known?.draft === draft) return known.library;
  const library: KitRead = {
    ...read,
    files: draft.tree,
    binaries: Object.entries(draft.binaryTree).map(([path, { hash }]) => ({ path, hash })),
  };
  drafted.set(read, { draft, library });
  return library;
}

/** `draftedLibrary` of the server being edited, read again as the draft changes. */
export function useDraftedLibrary(): KitRead | undefined {
  const read = useKitStore((s) => s.read);
  const draft = useProjectDraftStore((s) => (read ? s.drafts[read.projectId] : undefined));
  return draftedLibrary(read, draft);
}
