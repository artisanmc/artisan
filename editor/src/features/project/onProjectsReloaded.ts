import { isDirty } from "@/features/project/draft";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

/**
 * What the editor does with a reload announced by the plugin.
 *
 * The plugin re-reads its Projects on `/artisan reload` (and on its own
 * writes): the only moment a hand edit on the disk becomes real. Without this
 * announcement, the editor kept its last known version until someone thought
 * of refreshing.
 *
 * The behaviour here is deliberately timid:
 *
 * - **Re-read only if the announced fingerprint differs** from the one held.
 *   A reload that changes nothing for us must cost nothing.
 * - **Touch nothing if a dirty draft exists, anywhere.** It exists nowhere
 *   else, and replacing it without asking would do behind the admin's back
 *   what the Refresh button asks them to confirm. "Which one is open?" is
 *   deliberately not asked: the URL sometimes carries a slug where the draft
 *   carries an internal id, and a wrong match would overwrite work. Holding
 *   back too much here only costs a click on Refresh.
 */
export function onProjectsReloaded(
  serverKeyId: string,
  projects: { id: string; hash: string }[],
): void {
  const cache = useProjectCacheStore.getState();
  const dirtySomewhere = Object.values(useProjectDraftStore.getState().drafts).some((d) =>
    isDirty(d.initialTree, d.tree),
  );
  if (dirtySomewhere) return;

  // The plugin only knows ids; our keys carry what the URL shows (often a
  // slug). So a known version is recognised by its server and disk id, not by
  // its key.
  const known = Object.values(cache.entries);
  for (const p of projects) {
    const mine = known.find((e) => e.serverKeyId === serverKeyId && e.diskId === p.id);
    if (!mine) continue;
    if (mine.hash && mine.hash === p.hash) continue;
    cache.requestReload();
    return;
  }
}
