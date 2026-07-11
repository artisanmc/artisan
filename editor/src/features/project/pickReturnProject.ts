/**
 * Pick which pack to land on after a page reload. We prefer the pack the
 * user was last editing (persisted in `uiStore.lastActiveProjectId`) so a
 * refresh keeps them in place, and fall back to the first pack when that id
 * isn't among the available projects (fresh account, deleted pack, or an id
 * from another server/network).
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
