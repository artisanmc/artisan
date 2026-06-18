/**
 * Pick which pack to land on after a session is restored on page reload.
 *
 * `sessionStore` is in-memory only, so a refresh always bounces through
 * `/session` (cookie-based token refresh). Without this, `/session` navigated
 * blindly to `projects[0]`, so reloading any workspace kicked you back to the
 * first pack. We prefer the pack the user was last editing (persisted in
 * `uiStore.lastActiveProjectId`) so a refresh keeps you in place, and fall back
 * to the first pack when that id isn't among the session's projects (fresh
 * session, deleted pack, or an id from another server/network).
 */
export function pickReturnProject<T extends { id: string }>(
  projects: readonly T[],
  lastActiveProjectId: string | null,
): T | undefined {
  if (lastActiveProjectId) {
    const found = projects.find((p) => p.id === lastActiveProjectId);
    if (found) return found;
  }
  return projects[0];
}
