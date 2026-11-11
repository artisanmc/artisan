import type { ProjectDraft } from "./draft";

/**
 * Draft notification between tabs of the same browser.
 *
 * A tab that completes a write tells the others: a tab left open without
 * local work realigns on its own; a tab with changes sees the conflict right
 * away instead of waiting for a 409. Cross-device is not covered (it goes
 * through the `409 draft_conflict`).
 */
export type DraftSavedMessage = {
  ownerId: string;
  projectId: string;
  remote: { id: string; name: string; revision: number; snapshot: ProjectDraft };
};

const CHANNEL = "artisan.projectDrafts";
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel(CHANNEL);
  return channel;
}

/** Broadcasts a successful draft write (never a received draft). */
export function broadcastDraftSaved(
  ownerId: string,
  projectId: string,
  remote: DraftSavedMessage["remote"],
): void {
  getChannel()?.postMessage({ ownerId, projectId, remote } satisfies DraftSavedMessage);
}

export function subscribeDraftSaved(handler: (message: DraftSavedMessage) => void): () => void {
  const bc = getChannel();
  if (!bc) return () => {};
  const listener = (event: MessageEvent<DraftSavedMessage>) => handler(event.data);
  bc.addEventListener("message", listener);
  return () => bc.removeEventListener("message", listener);
}
