import { useAuthStore } from "@/state/authStore";

/**
 * Free or Pro jar, as the hub tells it with the user (`edition`, docs/architecture/editions.md).
 * Only **editing** the Pro parts is gated (title composer, resource pack, image and font import):
 * content made with Pro is always shown, and the server keeps rendering it.
 *
 * A hub that says nothing (older than editions, mock) is Pro: it had every feature.
 */
export type Edition = "free" | "pro";

export function editionOf(user: { edition?: Edition | null } | null | undefined): Edition {
  return user?.edition === "free" ? "free" : "pro";
}

/** Outside React (pack rebuild after a publish). */
export function isProEdition(): boolean {
  return editionOf(useAuthStore.getState().currentUser) === "pro";
}

export function useIsPro(): boolean {
  return useAuthStore((s) => editionOf(s.currentUser) === "pro");
}
