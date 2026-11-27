import { flushDraftEdits } from "@/features/project/draftFlush";
import { ensurePersistedDraft } from "@/features/project/persistedDrafts";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { openLibraryDraft } from "./libraryDraft";

/**
 * Writes the text file `path` into the player's draft of the Project `projectId`, open in this
 * tab or not (`content` `null`: takes it off). Meant for a file no view of the Project edits,
 * such as a theme's `palette.yml`, written from the server's Resources. It reaches the server
 * when that draft is deployed.
 */
export async function writeDraftFile(
  projectId: string,
  path: string,
  content: string | null,
): Promise<void> {
  await openLibraryDraft(projectId);
  flushDraftEdits();
  const drafts = useProjectDraftStore.getState();
  let local = drafts.get(projectId);
  if (!local) {
    const baselines = useProjectBaselineStore.getState();
    const baseline = baselines.get(projectId);
    if (!baseline) throw new Error("draft_unavailable");
    const binaries = baselines.binaryBaselines[projectId] ?? {};
    local = {
      baseline,
      tree: baseline,
      initialTree: baseline,
      binaryBaseline: binaries,
      binaryTree: binaries,
      at: Date.now(),
    };
  }
  if ((local.tree[path] ?? null) === content) return;
  const tree = { ...local.tree };
  if (content === null) delete tree[path];
  else tree[path] = content;
  drafts.save(projectId, { ...local, tree, at: Date.now() });
  // A Project open in this tab is what its draft is written from: it takes the file too.
  const { useProjectsStore } = await import("@/state/projectsStore");
  const project = useProjectsStore
    .getState()
    .openProjects.projects.find((entry) => entry.id === projectId);
  if (project) {
    const { adoptDiskIntoProject } = await import("@/features/project/saveProjectToDisk");
    useProjectsStore
      .getState()
      .replaceProject(
        adoptDiskIntoProject(
          project,
          content === null ? {} : { [path]: content },
          content === null ? [path] : [],
        ),
      );
  }
  await ensurePersistedDraft(projectId);
}
