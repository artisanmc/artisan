import { readDraftBlob } from "@/lib/api/projectDrafts";
import { type PixelSize, pixelSize } from "@/lib/pack/imageFunction";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { readPublishedBinary } from "./localAssets";

/** A file whose pixels are to be measured: where it is, and the hash of its content. */
export interface MeasuredFile {
  projectId: string;
  path: string;
  hash: string;
  /** Read as published, whatever a draft of the Project holds. */
  published?: boolean;
}

/**
 * Pixel sizes read from the files themselves, by content hash: a file of that hash has that
 * size wherever it is. `null`: a file that is no image, as the pack reads it.
 */
const useSizes = create<{ byHash: Record<string, PixelSize | null> }>(() => ({ byHash: {} }));
const asked = new Set<string>();

async function bytesOf(file: MeasuredFile): Promise<Uint8Array | null> {
  const local = file.published ? undefined : useProjectDraftStore.getState().get(file.projectId);
  const published =
    local?.binaryBaseline ?? useProjectBaselineStore.getState().binaryBaselines[file.projectId];
  const draftId = local?.remote?.id;
  // The draft's blob when the file changed there, the published file otherwise.
  if (draftId && published?.[file.path]?.hash !== file.hash)
    return readDraftBlob(file.projectId, draftId, file.hash);
  return readPublishedBinary(file.projectId, file.path);
}

/**
 * The pixel size of each of `files`, as the pack measures an image (ADR
 * `common-images-and-themes`, decision 4): read once per content, `undefined` until it is. A
 * file that cannot be fetched stays unmeasured: the caller keeps what the descriptors state.
 */
export function usePixelSizes(
  files: readonly MeasuredFile[],
): (hash: string) => PixelSize | null | undefined {
  const byHash = useSizes((s) => s.byHash);
  useEffect(() => {
    for (const file of files) {
      if (file.hash in useSizes.getState().byHash || asked.has(file.hash)) continue;
      asked.add(file.hash);
      void bytesOf(file)
        .then((png) =>
          useSizes.setState((s) => ({ byHash: { ...s.byHash, [file.hash]: pixelSize(png) } })),
        )
        // Asked again the next time something needs it.
        .catch(() => asked.delete(file.hash));
    }
  }, [files]);
  return useMemo(() => (hash: string) => (hash in byHash ? byHash[hash] : undefined), [byHash]);
}

/** Forgets every size: tests start from nothing. */
export function resetPixelSizes() {
  asked.clear();
  useSizes.setState({ byHash: {} });
}
