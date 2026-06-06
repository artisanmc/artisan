/**
 * Pick which pack to land on after a session is restored on page reload.
 *
 * `sessionStore` is in-memory only, so a refresh always bounces through
 * `/session` (cookie-based token refresh). Without this, `/session` navigated
 * blindly to `packs[0]`, so reloading any workspace kicked you back to the
 * first pack. We prefer the pack the user was last editing (persisted in
 * `uiStore.lastActivePackId`) so a refresh keeps you in place, and fall back
 * to the first pack when that id isn't among the session's packs (fresh
 * session, deleted pack, or an id from another server/network).
 */
export function pickReturnPack<T extends { id: string }>(
  packs: readonly T[],
  lastActivePackId: string | null,
): T | undefined {
  if (lastActivePackId) {
    const found = packs.find((p) => p.id === lastActivePackId);
    if (found) return found;
  }
  return packs[0];
}
