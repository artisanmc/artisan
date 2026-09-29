import type { ProjectDraft } from "./draft";

/**
 * Notification de brouillon entre onglets du même navigateur.
 *
 * Un onglet qui réussit une écriture prévient les autres : un onglet resté
 * ouvert sans travail local se réaligne tout seul ; un onglet avec des
 * modifications voit le conflit se présenter immédiatement au lieu d'attendre un
 * 409. Cross-appareil non couvert (il passe par le `409 draft_conflict`).
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

/** Diffuse l'écriture réussie d'un brouillon (jamais un brouillon reçu). */
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
