import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { flushDraftEdits } from "./draftFlush";
import { projectTree } from "./saveProjectToDisk";

/**
 * Moves the draft's "as loaded" reference (`initialTree`) by what [delta] did to the tree.
 *
 * Only the files the user left as loaded follow: a file already edited stays an edit.
 * Pure, exported for its test.
 */
export function absorbIntoInitialTree(
  initialTree: Record<string, string>,
  before: Record<string, string>,
  after: Record<string, string>,
): Record<string, string> {
  const next = { ...initialTree };
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[path] === after[path]) continue;
    if (initialTree[path] !== before[path]) continue;
    if (path in after) next[path] = after[path]!;
    else delete next[path];
  }
  return next;
}

/**
 * Runs a load-time transformation that lands after the Project was installed (a module's
 * kinds or declared actions arriving late: `adoptLateDocuments`, `adoptActionTexts`).
 *
 * Its effect on the tree is part of opening the Project, never the user's work: without
 * this, the draft compared the adopted tree to the reference frozen before it and saw an
 * edit, so a Project merely opened created a draft (and recreated it after a discard,
 * since the page reload replays the same late arrival).
 */
export function asLoadNormalization(projectId: string, transform: () => void): void {
  // The pending debounce first: the draft must describe the tree before the transformation.
  flushDraftEdits();
  const find = () =>
    useProjectsStore.getState().openProjects.projects.find((p) => p.id === projectId);
  const project = find();
  const draft = useProjectDraftStore.getState().get(projectId);
  const before = project && draft ? projectTree(project) : undefined;
  transform();
  const transformed = find();
  if (!before || !draft || !transformed || transformed === project) return;
  const current = useProjectDraftStore.getState().get(projectId);
  if (!current) return;
  const after = projectTree(transformed);
  const initialTree = absorbIntoInitialTree(current.initialTree ?? current.baseline, before, after);
  useProjectDraftStore.getState().save(projectId, { ...current, initialTree });
}
